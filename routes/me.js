'use strict';

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    full_name: 'Hoang Minh Nguyen (Cyrus)',
    student_number: 'n10375694',
  });
});

module.exports = router;
