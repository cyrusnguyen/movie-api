var express = require('express');
var router = express.Router();
const jwt = require('jsonwebtoken');
const authorizationPutProfile = require('../middleware/authorizationPutProfile');

router.get('/', async function(req, res, next) {
    await createUsersTableIfNotExists(req, res);
    
    const user = await req.db.from('users').select('*').where('email', '=', req.email).first();
    if (!user) {
        res.status(404).json({ "error": true, "message":"User not found"})
        return;
    }

    // If unauthenticated, return 3 fields
    const authHeader = req.headers;
    if (!("authorization" in authHeader)){
        res.status(200).json({
            "email" : user.email,
            "firstName" : user.firstName,
            "lastName" : user.lastName
        })
        return;
    }

    // Otherwise, check the ownership
    const token = authHeader.authorization.replace(/^Bearer /, "");
    if (isOwner(token, req.email) === true){
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

router.put('/', authorizationPutProfile, async function(req, res, next) {
    await createUsersTableIfNotExists(req, res);
    const date = new Date(req.body.dob) || null;
    const today = new Date();
    // Check valid inputs
    if (!req.body.firstName ||
        !req.body.lastName ||
        !req.body.dob ||
        !req.body.address) {
        return res.status(400).json({
            error: true,
            message: "Request body incomplete: firstName, lastName, dob and address are required."
        });
    }else if (
        
        typeof req.body.firstName !== "string" ||
        typeof req.body.lastName !== "string" ||
        typeof req.body.address !== "string" || 
        typeof req.body.dob !== "string"
      ) {
        return res.status(400).json({
          error: true,
          message: "Request body invalid: firstName, lastName and address must be strings only."
        });
    }else if (!isValidDateFormat(req.body.dob)) {
        return res.status(400).json({
          error: true,
          message: "Invalid input: dob must be a real date in format YYYY-MM-DD."
        });
    }else if (date.getTime() > today.getTime()){
        return res.status(400).json({
            error: true,
            message: "Invalid input: dob must be a date in the past."
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
                address: req.body.address,
                updated_at: req.db.fn.now()
            })
                .then(async () => {
                    // After updating, get user data to recheck
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
        return;
    }
    
}

// Check validation of date format
//ref: https://bobbyhadz.com/blog/javascript-check-if-date-is-valid
function isValidDateFormat(dateString){
    const regEx = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateString.match(regEx)) return false;  // Invalid format
    const date = new Date(dateString);

    //If date is in Date type and not null
    if ((date instanceof Date) && !isNaN(date)){
        // Check real date
        const [year, month, day] = dateString.split('-');
        const date = new Date(year, month - 1, day);
        return date.getFullYear() == year && date.getMonth() + 1 == month && date.getDate() == day;
    };
}

module.exports = router;
