var express = require('express');
var router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
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
            "firstName" : user.firstName,
            "lastName" : user.lastName,
            "dob" : user.dob,
            "address" : user.address,
        })
        return;
    }else if (isOwner(token, req.email) === false){
        res.status(200).json({
            "email" : user.email,
            "firstName" : user.firstName,
            "lastName" : user.lastName
        })
        return;
    }else {
        return;
    }
});

router.put('/', authorization, async function(req, res, next) {
    await createUsersTableIfNotExists(req, res);

    // Check valid inputs
    if (!req.body.firstName ||
        !req.body.lastName ||
        !req.body.dob ||
        !req.body.address) {
        return res.status(400).json({
            error: true,
            message: "Request body incomplete: firstName, lastName, dob and address are required"
        });
    }else if (
        
        typeof req.body.firstName !== "string" ||
        typeof req.body.lastName !== "string" ||
        typeof req.body.address !== "string" || 
        typeof req.body.dob !== "string"
      ) {
        return res.status(400).json({
          error: true,
          message: "Request body invalid: firstName, lastName, dob and address must be strings only"
        });
    }else if (!isValidDateFormat(req.body.dob)) {
        return res.status(400).json({
          error: true,
          message: "Invalid input: dob must be a real date in format YYYY-MM-DD"
        });
    }


    // Check if user exists
    const user = await req.db.from('users').select('*').where('email', '=', req.email).first();
    if (!user) {
        res.status(404).json({ "error": true, "message":"User not found"})
        return;
    }

    // Retrieve the token and check its ownership
    const token = req.headers.authorization.replace(/^Bearer /, "");
    if (isOwner(token, req.email)){
        try {
            // If being owner, update the user
            req.db.from("users").where("email", req.email).update({
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                dob: req.body.dob,
                address: req.body.address,})
                .then(async () => {
                    // After updaing, get user data to recheck
                    var updatedUser = await req.db.from("users").select("*").where('email', '=', req.email).first();
                    res.status(200).json({
                        "email" : updatedUser.email,
                        "firstName" : updatedUser.firstName,
                        "lastName" : updatedUser.lastName,
                        "dob" : updatedUser.dob,
                        "address" : updatedUser.address,
                    })
                    return;
                })
        } catch (err) {
            console.log(err);
            res.status(500).json({"error": true, "message": err})
            return;
        }
    // If not user, return error
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
        table.string("firstName");
        table.string("lastName");
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

// Check validation of date format
//ref: https://bobbyhadz.com/blog/javascript-check-if-date-is-valid
function isValidDateFormat(dateString){
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regEx)) return false;  // Invalid format
    const date = new Date(dateString);

    // Check if the date passed today.
    const today = new Date();
    if (date.getTime() > today.getTime()) return false;

    return date instanceof Date && !isNaN(date);
}

module.exports = router;
