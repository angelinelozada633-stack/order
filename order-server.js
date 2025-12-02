const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection
const DB_URL = 'mongodb+srv://raven:12345@test.q3j1urd.mongodb.net/Orders';
const JWT_SECRET = 'your-secret-key-change-in-production';

mongoose.connect(DB_URL)
    .then(() => console.log('✓ Order Server Connected to Database'))
    .catch(err => console.log('✗ Database Error:', err));

// Order Schema
const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    orderNumber: { type: String, required: true, unique: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, required: true },
        sku: String,
        name: String,
        quantity: Number,
        unitPrice: Number,
        totalPrice: Number
    }],
    shippingAddress: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String
    },
    billingAddress: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String
    },
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
    },
    statusHistory: [{
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String
    }],
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending'
    },
    paymentMethod: String,
    paymentDetails: {
        transactionId: String,
        paymentDate: Date
    },
    trackingNumber: String,
    estimatedDelivery: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Payment Schema
const paymentSchema = new mongoose.Schema({
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Order' },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    amount: { type: Number, required: true },
    method: { 
        type: String, 
        enum: ['credit_card', 'debit_card', 'paypal', 'gcash', 'cash_on_delivery'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    transactionId: String,
    cardDetails: {
        last4: String,
        brand: String
    },
    failureReason: String,
    retryCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', orderSchema);
const Payment = mongoose.model('Payment', paymentSchema);

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(403).json({
            success: false,
            message: 'No token provided'
        });
    }
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }
        req.userId = decoded.id;
        req.userRole = decoded.role;
        next();
    });
};

// Generate unique order number
const generateOrderNumber = () => {
    const timestamp = Date.now().toString();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `ORD-${timestamp}-${random}`;
};

// ============================================
// ORDER ENDPOINTS
// ============================================

// Create new order
app.post('/api/orders', verifyToken, async (req, res) => {
    try {
        const { 
            items, 
            shippingAddress, 
            billingAddress, 
            subtotal, 
            tax, 
            shippingFee,
            discount,
            paymentMethod 
        } = req.body;
        
        const totalAmount = subtotal + tax + shippingFee - (discount || 0);
        
        const newOrder = new Order({
            userId: req.userId,
            orderNumber: generateOrderNumber(),
            items,
            shippingAddress,
            billingAddress: billingAddress || shippingAddress,
            subtotal,
            tax,
            shippingFee,
            discount: discount || 0,
            totalAmount,
            paymentMethod,
            statusHistory: [{
                status: 'pending',
                timestamp: Date.now(),
                note: 'Order created'
            }]
        });
        
        await newOrder.save();
        
        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: newOrder
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get all orders for user
app.get('/api/orders', verifyToken, async (req, res) => {
    try {
        const orders = await Order.find({ userId: req.userId }).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get orders by status
app.get('/api/orders/status/:status', verifyToken, async (req, res) => {
    try {
        const { status } = req.params;
        
        const orders = await Order.find({ 
            userId: req.userId,
            status: status 
        }).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Filter orders (date range, amount range)
app.get('/api/orders/filter', verifyToken, async (req, res) => {
    try {
        const { startDate, endDate, minAmount, maxAmount, status } = req.query;
        
        let query = { userId: req.userId };
        
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }
        
        if (minAmount || maxAmount) {
            query.totalAmount = {};
            if (minAmount) query.totalAmount.$gte = parseFloat(minAmount);
            if (maxAmount) query.totalAmount.$lte = parseFloat(maxAmount);
        }
        
        if (status) {
            query.status = status;
        }
        
        const orders = await Order.find(query).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get order by ID
app.get('/api/orders/:id', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.userId.toString() !== req.userId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        res.json({
            success: true,
            data: order
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get order by order number
app.get('/api/orders/number/:orderNumber', verifyToken, async (req, res) => {
    try {
        const order = await Order.findOne({ orderNumber: req.params.orderNumber });
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.userId.toString() !== req.userId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        res.json({
            success: true,
            data: order
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get order timeline/tracking
app.get('/api/orders/:id/timeline', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.userId.toString() !== req.userId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        res.json({
            success: true,
            data: {
                orderNumber: order.orderNumber,
                currentStatus: order.status,
                trackingNumber: order.trackingNumber,
                estimatedDelivery: order.estimatedDelivery,
                timeline: order.statusHistory
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get order receipt/invoice
app.get('/api/orders/:id/receipt', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.userId.toString() !== req.userId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const receipt = {
            orderNumber: order.orderNumber,
            orderDate: order.createdAt,
            items: order.items,
            subtotal: order.subtotal,
            tax: order.tax,
            shippingFee: order.shippingFee,
            discount: order.discount,
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            shippingAddress: order.shippingAddress,
            billingAddress: order.billingAddress
        };
        
        res.json({
            success: true,
            data: receipt
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Reorder (create new order from existing)
app.post('/api/orders/:id/reorder', verifyToken, async (req, res) => {
    try {
        const existingOrder = await Order.findById(req.params.id);
        
        if (!existingOrder) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (existingOrder.userId.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const newOrder = new Order({
            userId: req.userId,
            orderNumber: generateOrderNumber(),
            items: existingOrder.items,
            shippingAddress: existingOrder.shippingAddress,
            billingAddress: existingOrder.billingAddress,
            subtotal: existingOrder.subtotal,
            tax: existingOrder.tax,
            shippingFee: existingOrder.shippingFee,
            discount: 0,
            totalAmount: existingOrder.subtotal + existingOrder.tax + existingOrder.shippingFee,
            paymentMethod: existingOrder.paymentMethod,
            statusHistory: [{
                status: 'pending',
                timestamp: Date.now(),
                note: `Reordered from ${existingOrder.orderNumber}`
            }]
        });
        
        await newOrder.save();
        
        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            data: newOrder
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Update order status (admin only)
app.put('/api/orders/:id/status', verifyToken, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const { status, note, trackingNumber, estimatedDelivery } = req.body;
        
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        order.status = status;
        order.updatedAt = Date.now();
        
        if (trackingNumber) order.trackingNumber = trackingNumber;
        if (estimatedDelivery) order.estimatedDelivery = estimatedDelivery;
        
        order.statusHistory.push({
            status: status,
            timestamp: Date.now(),
            note: note || `Status updated to ${status}`
        });
        
        await order.save();
        
        res.json({
            success: true,
            message: 'Order status updated',
            data: order
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Bulk order status update (admin only)
app.put('/api/admin/orders/bulk-status', verifyToken, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const { orderIds, status, note } = req.body;
        
        const updates = await Promise.all(
            orderIds.map(async (orderId) => {
                const order = await Order.findById(orderId);
                if (order) {
                    order.status = status;
                    order.updatedAt = Date.now();
                    order.statusHistory.push({
                        status: status,
                        timestamp: Date.now(),
                        note: note || `Bulk status update to ${status}`
                    });
                    await order.save();
                    return order;
                }
                return null;
            })
        );
        
        res.json({
            success: true,
            message: `${updates.filter(o => o !== null).length} orders updated`,
            data: updates.filter(o => o !== null)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Cancel order
app.put('/api/orders/:id/cancel', verifyToken, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.userId.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        if (order.status !== 'pending' && order.status !== 'processing') {
            return res.status(400).json({
                success: false,
                message: 'Cannot cancel order in current status'
            });
        }
        
        order.status = 'cancelled';
        order.updatedAt = Date.now();
        order.statusHistory.push({
            status: 'cancelled',
            timestamp: Date.now(),
            note: 'Order cancelled by customer'
        });
        
        await order.save();
        
        res.json({
            success: true,
            message: 'Order cancelled',
            data: order
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get all orders (admin only)
app.get('/api/admin/orders', verifyToken, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const orders = await Order.find().sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get order statistics (admin only)
app.get('/api/admin/orders/stats', verifyToken, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const totalOrders = await Order.countDocuments();
        const pendingOrders = await Order.countDocuments({ status: 'pending' });
        const processingOrders = await Order.countDocuments({ status: 'processing' });
        const shippedOrders = await Order.countDocuments({ status: 'shipped' });
        const deliveredOrders = await Order.countDocuments({ status: 'delivered' });
        const cancelledOrders = await Order.countDocuments({ status: 'cancelled' });
        
        const revenueResult = await Order.aggregate([
            { $match: { paymentStatus: 'paid' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        
        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;
        
        const averageOrderResult = await Order.aggregate([
            { $group: { _id: null, average: { $avg: '$totalAmount' } } }
        ]);
        
        const averageOrderValue = averageOrderResult.length > 0 ? averageOrderResult[0].average : 0;
        
        res.json({
            success: true,
            data: {
                totalOrders,
                ordersByStatus: {
                    pending: pendingOrders,
                    processing: processingOrders,
                    shipped: shippedOrders,
                    delivered: deliveredOrders,
                    cancelled: cancelledOrders
                },
                totalRevenue,
                averageOrderValue
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ============================================
// PAYMENT ENDPOINTS
// ============================================

// Process payment
app.post('/api/payments/process', verifyToken, async (req, res) => {
    try {
        const { orderId, method, cardDetails } = req.body;
        
        const order = await Order.findById(orderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        if (order.userId.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        
        const payment = new Payment({
            orderId,
            userId: req.userId,
            amount: order.totalAmount,
            method,
            transactionId,
            cardDetails: cardDetails ? {
                last4: cardDetails.last4,
                brand: cardDetails.brand
            } : null,
            status: 'completed'
        });
        
        await payment.save();
        
        order.paymentStatus = 'paid';
        order.paymentDetails = {
            transactionId,
            paymentDate: Date.now()
        };
        order.status = 'processing';
        order.updatedAt = Date.now();
        order.statusHistory.push({
            status: 'processing',
            timestamp: Date.now(),
            note: 'Payment received, order is being processed'
        });
        
        await order.save();
        
        res.json({
            success: true,
            message: 'Payment processed successfully',
            data: {
                payment,
                order
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Retry failed payment
app.post('/api/payments/:id/retry', verifyToken, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }
        
        if (payment.userId.toString() !== req.userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        if (payment.status !== 'failed') {
            return res.status(400).json({
                success: false,
                message: 'Can only retry failed payments'
            });
        }
        
        payment.status = 'completed';
        payment.retryCount += 1;
        payment.updatedAt = Date.now();
        await payment.save();
        
        const order = await Order.findById(payment.orderId);
        if (order) {
            order.paymentStatus = 'paid';
            order.status = 'processing';
            order.updatedAt = Date.now();
            order.statusHistory.push({
                status: 'processing',
                timestamp: Date.now(),
                note: 'Payment retry successful'
            });
            await order.save();
        }
        
        res.json({
            success: true,
            message: 'Payment retry successful',
            data: { payment, order }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get payment details
app.get('/api/payments/:id', verifyToken, async (req, res) => {
    try {
        const payment = await Payment.findById(req.params.id);
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }
        
        if (payment.userId.toString() !== req.userId && req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        res.json({
            success: true,
            data: payment
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get payments by order
app.get('/api/payments/order/:orderId', verifyToken, async (req, res) => {
    try {
        const payments = await Payment.find({ orderId: req.params.orderId });
        
        if (payments.length > 0) {
            if (payments[0].userId.toString() !== req.userId && req.userRole !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied'
                });
            }
        }
        
        res.json({
            success: true,
            data: payments
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get user's payment history
app.get('/api/payments/user/history', verifyToken, async (req, res) => {
    try {
        const payments = await Payment.find({ userId: req.userId }).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: payments
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get payment statistics (admin only)
app.get('/api/admin/payments/stats', verifyToken, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const totalPayments = await Payment.countDocuments();
        const completedPayments = await Payment.countDocuments({ status: 'completed' });
        const failedPayments = await Payment.countDocuments({ status: 'failed' });
        const refundedPayments = await Payment.countDocuments({ status: 'refunded' });
        
        const revenueResult = await Payment.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        
        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;
        
        const methodBreakdown = await Payment.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: '$method', count: { $sum: 1 }, total: { $sum: '$amount' } } }
        ]);
        
        res.json({
            success: true,
            data: {
                totalPayments,
                paymentsByStatus: {
                    completed: completedPayments,
                    failed: failedPayments,
                    refunded: refundedPayments
                },
                totalRevenue,
                paymentMethodBreakdown: methodBreakdown
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Refund payment (admin only)
app.post('/api/payments/:id/refund', verifyToken, async (req, res) => {
    try {
        if (req.userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }
        
        const payment = await Payment.findById(req.params.id);
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }
        
        if (payment.status !== 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Can only refund completed payments'
            });
        }
        
        payment.status = 'refunded';
        payment.updatedAt = Date.now();
        await payment.save();
        
        const order = await Order.findById(payment.orderId);
        if (order) {
            order.paymentStatus = 'refunded';
            order.updatedAt = Date.now();
            order.statusHistory.push({
                status: order.status,
                timestamp: Date.now(),
                note: 'Payment refunded'
            });
            await order.save();
        }
        
        res.json({
            success: true,
            message: 'Payment refunded',
            data: payment
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Payment webhook simulation (for demo)
app.post('/api/payments/webhook', async (req, res) => {
    try {
        const { transactionId, status } = req.body;
        
        const payment = await Payment.findOne({ transactionId });
        
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }
        
        payment.status = status;
        payment.updatedAt = Date.now();
        await payment.save();
        
        res.json({
            success: true,
            message: 'Webhook processed'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Server start
const PORT = 3003;
app.listen(PORT, () => {
    console.log('✓ Order & Payment Server is running!');
    console.log('✓ http://localhost:' + PORT);
});