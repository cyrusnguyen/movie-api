var express = require('express');
var router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});

router.post('/login', function (req, res, next) {
  // 1. Retrieve email and password from req.body
  var email = req.body.email;
  var password = req.body.password;
  var longExpiry = req.body.longExpiry || false;
  var bearerExpiresInSeconds = req.body.bearerExpiresInSeconds || 600;
  var refreshExpiresInSeconds = req.body.refreshExpiresInSeconds || 86400;

  // Verify body
  if (!email || !password) {
    res.status(400).json({
      error: true,
      message: "Request body incomplete - email and password needed"
    });
    return;
  }

  // 2. Determine if user already exists in table
  const queryUsers = req.db.from("users").select("*").where("email", "=", email);
  queryUsers
    .then(users => {
      if (users.length === 0) {
        // 2.2 If user does not exist, return error response
        res.status(401).json({
          error: true,
          message: "There's no account associated with this email address or username."
        });
        return null;
      }

      // 2.1 If user does exist, verify if passwords match
      return bcrypt.compare(password, users[0].password);
    })
    .then(match => {
      if (match === null) {
        return;
      }
      if (!match) {
        // 2.1.2 If passwords do not match, return error response
        res.status(401).json({
          error: true,
          message: "Incorrect email or password"
        });
        return;
      }
      
      // 2.1.1 If passwords match, return JWT
      
      res.status(200).json({
        "bearerToken": generateToken("Bearer", email, bearerExpiresInSeconds),
        "refreshToken": generateToken("Refresh", email, refreshExpiresInSeconds)
      });
    })
    .catch(err => {
      // Log error to the console and send response
      console.log(err);
      res.status(500).json({error: true, message: err});
    });
});


router.post('/register', async function (req, res, next) {
  // Retrieve email and password from req.body
  const email = req.body.email;
  const password = req.body.password;
  
  // Verify body
  if (!email || !password) {
    res.status(400).json({
      error: true,
      message: "Request body incomplete - email and password needed"
    });
    return;
  }
  await createUsersTableIfNotExists(req, res);

  // Determine if user already exists in table
  const users = await req.db.from("users").select("*").where("email", "=", email)
  if (users.length > 0) {
    res.status(409).json({
      "error": true,
      "message": "User already exists"
    });
    return;
  }

  // Insert user into DB
  const firstName = req.body.firstname || null;
  const lastName = req.body.lastname || null;
  const dob = req.body.dob || null;
  const address = req.body.address || null;
  const saltRounds = 10;
  const hash = bcrypt.hashSync(password, saltRounds);
  req.db.from("users").insert({ 
    email: email, password: hash, firstName: firstName, lastName: lastName, dob: dob, address: address}).then(() => {
      res.status(201).json({ message: "User created" });
    }).catch(e =>{
      console.log(e)
      res.status(500).json({ "error": true, message: e });
    })
});

router.post('/logout', function (req, res) {

  // Retrieve refreshToken from req.body
  const refreshToken = req.body.refreshToken;

  // Verify refreshToken
  if (!refreshToken) {
    res.status(400).json({
      error: true,
      message: "Request body incomplete - refreshToken needed"
    });
    return;
  }

  // 2. Invalidate refreshToken
  // This can be done by adding the refreshToken to a blacklist, or by deleting it from the database if it is stored there.
  // The implementation will vary depending on how you handle token storage and validation.

  res.status(200).json({message: "Logout successful"});
});

router.post('/refresh', function (req, res) {
  // Retrieve refreshToken from req.body
  const refreshToken = req.body.refreshToken;

  // Verify body
  if (!refreshToken) {
    res.status(400).json({
      error: true,
      message: "Request body incomplete, refresh token required"
    });
    return;
  }

  // 2. Verify refreshToken
  // This can be done by checking if the refreshToken is in a blacklist, or by verifying it against the database if it is stored there.
  // The implementation will vary depending on how you handle token storage and validation.

  // 3. Generate new bearerToken
  var newBearerToken = generateToken("Bearer", email);

  res.status(200).json({
    "bearerToken": newBearerToken,
    "refreshToken": refreshToken
  });
});


function generateToken(tokenType, email, expires_in){
  var expiresIn = parseInt(expires_in) || 600;
  var exp = Math.floor(Date.now() / 1000) + expiresIn;
  var token = jwt.sign({ email, exp }, process.env.JWT_SECRET);
  return {
    "token": token,
    "token_type": tokenType,
    "expires_in": expiresIn
  }
}


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




module.exports = router;
