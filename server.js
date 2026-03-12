const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan')
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(cors(
  {
    origin: process.env.FRONTEND_URL,
    // credentials: true,
  }
));
app.use(express.json());
app.use(morgan('dev'))

app.get('/', (req, res) => {
  res.send('Welcome to Punctual Attendance System Api Version 1.0.0');
});

// Routes
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/classes', require('./routes/classes'));
app.use('/api/v1/attendance', require('./routes/attendance'));

const PORT = process.env.PORT || 5000;

const { checkMissedClasses } = require('./utils/notifications');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');

    // Start background checks for missed classes every 5 minutes
    setInterval(checkMissedClasses, 5 * 60 * 1000);

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => console.error('Could not connect to MongoDB', err));


module.exports = app;
