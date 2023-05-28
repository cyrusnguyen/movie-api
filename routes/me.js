var express = require('express');
var router = express.Router();


router.get("/", function (req, res, next) {
  return res.json({
    full_name: "Hoang Minh Nguyen (Cyrus)",
    student_number: "n10375694",
  });
});

module.exports = router;
