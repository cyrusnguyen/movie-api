var express = require('express');
var router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');
const authorization = require('../middleware/authorization');

router.get('/', authorization, async function(req, res, next) {
    await createUsersTableIfNotExists(req, res);
    
    const user = await req.db.from('users').select('*').where('email', '=', req.email).first();
    if (!user) {
        res.status(404).json({ "error": true, "message":"User not found"})
        return;
    }

    const token = req.headers.authorization.replace(/^Bearer /, "");
    if (isOwner(token, req.email)){
        res.status(200).json({
            "email" : user.email,
            "firstName" : user.firstname,
            "lastName" : user.lastname,
            "dob" : user.dob,
            "address" : user.address,
        })
        return;
    }else if (isOwner(token, req.email) === false){
        res.status(200).json({
            "email" : user.email,
            "firstName" : user.firstname,
            "lastName" : user.lastname
        })
        return;
    }else {
        return;
    }
});
//eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6IjFAMS4xIiwiZXhwIjoxNjg1NjEwODM2LCJpYXQiOjE2ODU2MDA4MzZ9.CPZ5FBHo8pxdncGHkzj8hXkV8W40PkYw9UUGz1SZGik
router.put('/', authorization, async function(req, res, next) {
    await createUsersTableIfNotExists(req, res);

    if (!req.body.firstName ||
        !req.body.lastName ||
        !req.body.dob ||
        !req.body.address) {
        return res.status(400).json({
            error: true,
            message:
              "Request body incomplete: firstName, lastName, dob and address are required.",
        });
    }else if (!isValidDateFormat(req.body.dob)) {
        return res.status(400).json({
          error: true,
          message:
            "Invalid input: dob must be a real date in format YYYY-MM-DD.",
        });
    }

    const user = await req.db.from('users').select('*').where('email', '=', req.email).first();
    if (!user) {
        res.status(404).json({ "error": true, "message":"User not found"})
        return;
    }

    

    const token = req.headers.authorization.replace(/^Bearer /, "");
    if (isOwner(token, req.email)){
        res.status(200).json({
            "email" : user.email,
            "firstName" : user.firstname,
            "lastName" : user.lastname,
            "dob" : user.dob,
            "address" : user.address,
        })
        return;
    }else{
        res.status(403).json({
            "error" : true,
            "message": "Forbidden"
        })
        return;
    }
});


async function createUsersTableIfNotExists(req, res) {
    const exists = await req.db.schema.hasTable('users');
    if (!exists) {
      await req.db.schema.createTable('users', function(table) {
        table.uuid('id').primary().defaultTo(req.db.raw('(UUID())'));
        table.string("firstname");
        table.string("lastname");
        table.string("dob");
        table.string("address");
        table.string("email");
        table.string('password');
        table.timestamp('created_at').defaultTo(req.db.fn.now());
        table.timestamp('updated_at').defaultTo(req.db.fn.now());
      });
    }
  
}

function isOwner(token, email){
    try {
        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        if (decodedToken.email === email){
            return true;
        }
        return false;
    } catch (e) {
        if (e.name === "TokenExpiredError") {
            res.status(401).json({ error: true, message: "JWT token has expired" });
        } else {
            res.status(401).json({ error: true, message: "Invalid JWT token" });
        }
        return null;
    }
}

function isValidDateFormat(date){
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
}

module.exports = router;
