const mongoose = require('mongoose');
// Market Rate Schema
const marketRateSchema = new mongoose.Schema({
    goldRate22K: { 
        type: Number, 
        required: true 
    },
    silverRate: { 
        type: Number, 
        required: true 
    }
});
// Export Model
module.exports = mongoose.model('MarketRate', marketRateSchema);