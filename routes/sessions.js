const express = require('express');
const router = express.Router();
const Session = require('../models/Session');
const { auth, authorize } = require('../middleware/auth');

// @route   POST api/sessions
// @desc    Create a new session (Manager only)
router.post('/', auth, authorize('manager'), async (req, res) => {
  const { name, section } = req.body;
  try {
    const newSession = new Session({
      name,
      section,
      manager: req.user.id
    });
    await newSession.save();
    res.json(newSession);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   GET api/sessions
// @desc    Get all sessions for a user (Manager: owned, Worker: enrolled)
router.get('/', auth, async (req, res) => {
  try {
    let sessions;
    if (req.user.role === 'manager') {
      sessions = await Session.find({ manager: req.user.id }).populate('workers', 'name email');
    } else {
      sessions = await Session.find({ workers: req.user.id });
    }
    res.json(sessions);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/sessions/:id/enroll
// @desc    Enroll a worker in a session (Manager adds worker)
router.post('/:id/enroll', auth, authorize('manager'), async (req, res) => {
  const { workerEmail } = req.body;
  const User = require('../models/User');
  try {
    const worker = await User.findOne({ email: workerEmail, role: 'worker' });
    if (!worker) return res.status(404).json({ message: 'Worker not found' });

    const targetSession = await Session.findById(req.params.id);
    if (!targetSession) return res.status(404).json({ message: 'Session not found' });

    if (targetSession.workers.includes(worker.id)) {
      return res.status(400).json({ message: 'Worker already enrolled' });
    }

    targetSession.workers.push(worker.id);
    await targetSession.save();
    res.json(targetSession);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// @route   POST api/sessions/:id/join
// @desc    Worker self-enrollment (Join session)
router.post('/:id/join', auth, authorize('worker'), async (req, res) => {
  const { sendNotification } = require('../utils/notifications');
  const User = require('../models/User');
  try {
    const targetSession = await Session.findById(req.params.id).populate('manager', 'name fcmTokens');
    if (!targetSession) return res.status(404).json({ message: 'Session not found' });

    if (targetSession.workers.includes(req.user.id)) {
      return res.status(400).json({ message: 'You are already enrolled in this session' });
    }

    targetSession.workers.push(req.user.id);
    await targetSession.save();

    // Notify Manager
    try {
      const worker = await User.findById(req.user.id);
      if (targetSession.manager && targetSession.manager.fcmTokens?.length > 0) {
        await sendNotification(targetSession.manager.fcmTokens, {
          title: 'New Worker Joined! 🏢',
          body: `${worker.name} has joined your session: ${targetSession.name}`
        });
      }
      
      // Notify Worker
      if (worker.fcmTokens?.length > 0) {
        await sendNotification(worker.fcmTokens, {
          title: 'Successfully Joined! ✅',
          body: `You are now registered for ${targetSession.name}`
        });
      }
    } catch (notifyErr) {
      console.error('Enrollment notification failed:', notifyErr.message);
    }

    res.json({ message: 'Successfully joined session', session: targetSession });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
