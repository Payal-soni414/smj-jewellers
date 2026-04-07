// Custom Order Model
// Import Mongoose
const mongoose = require('mongoose');
// Define Custom Order Schema
const customOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customerName: String,
    phone: String,
    details: String,
    imagePaths: [String], 
    status: { type: String, default: 'Pending' }, 
    date: { type: Date, default: Date.now }
});
// Export the CustomOrder model
module.exports = mongoose.model('CustomOrder', customOrderSchema);