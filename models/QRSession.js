const mongoose = require('mongoose');

const qrSessionSchema = new mongoose.Schema({
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startTime: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  active: { type: Boolean, default: true },
});

module.exports = mongoose.model('QRSession', qrSessionSchema);
