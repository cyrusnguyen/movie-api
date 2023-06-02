var express = require('express');
var router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');

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
    .then(async match => {
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
      const bearerToken = await generateToken(req, "Bearer", email, bearerExpiresInSeconds);
      const refreshToken = await generateToken(req, "Refresh", email, refreshExpiresInSeconds);
      res.status(200).json({
        "bearerToken": bearerToken,
        "refreshToken": refreshToken
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
  const firstName = req.body.firstName || null;
  const lastName = req.body.lastName || null;
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

router.post('/logout', async function (req, res) {

  // Retrieve refreshToken from req.body
  const refreshToken = req.body.refreshToken;

  // Verify refreshToken
  if (!refreshToken) {
    res.status(400).json({
      error: true,
      message: "Request body incomplete, refresh token required"
    });
    return;
  }
  try{
    jwt.verify(refreshToken, process.env.JWT_SECRET);
  }catch (e){
    if (e.name === "TokenExpiredError") {
      res.status(401).json({ error: true, message: "JWT token has expired" });
      
    }else{
      res.status(401).json({
        error: true,
        message: "Invalid JWT token"
      });
    }
    return;
  }

  // Invalidate refreshToken
  await createTokensTableIfNotExists(req);
  const token = await req.db.from('tokens').select("*").where('token', '=', req.body.refreshToken).first();
  
  
  
  if (!token){
    res.status(401).json({
      error: true,
      message: "Invalid JWT token"
    });
    return;
  }else{
    await req.db.from('tokens').where({ token: req.body.refreshToken }).del().then(() => {
      res.status(200).json({"error": false, "message": "Token successfully invalidated"});
      return;
    }).catch(err => {
      console.log(err);
      res.status(500).json({"error":true, "message": err});
    })
  }
  
    
  
});

router.post('/refresh', async function (req, res) {
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

  // Verify refreshToken
  await createTokensTableIfNotExists(req);

  const queryTokens = req.db.from("tokens").select("*").where("token", "=", refreshToken).first();
  queryTokens
    .then(async result => {
      // If token not in the server return error
      if(!result){
        res.status(401).json({
          "error": true,
          "message": "Invalid JWT token"
        });
        return;
      }
      else{
        // If token exists, check the expiration
        try {
          jwt.verify(result.token, process.env.JWT_SECRET);
        } catch (e) {
            if (e.name === "TokenExpiredError") {
                res.status(401).json({ error: true, message: "JWT token has expired" });
                
            } else {
                res.status(401).json({ error: true, message: "Invalid JWT token" });
            }
            await req.db.from('tokens').where({ token: result.token }).del();
            return;
        }
        // Generate new bearerToken
        var newBearerToken = await generateToken(req, "Bearer", result.email, 600);

        res.status(200).json({
          "bearerToken": newBearerToken,
          "refreshToken": {
            "token": result.token,
            "token_type": "Refresh",
            "expires_in": 86400
          }
        });
        return;
      }
  }).catch(err => {
    console.log(err);
    res.status(500).json({"error": true, "message": err});
  })

  

  
});


async function generateToken(req, tokenType, email, expires_in){
  var expiresIn = parseInt(expires_in) || 600;
  var exp = Math.floor(Date.now() / 1000) + expiresIn;
  var token = jwt.sign({ email, exp }, process.env.JWT_SECRET);
  if (tokenType === 'Refresh'){
    await createTokensTableIfNotExists(req);
    await req.db.from("tokens").insert({ 
      token: token, email: email, exp: exp})
      .catch(e =>{
        console.log(e)
        res.status(500).json({ "error": true, message: e });
    })
  }
  return {
    "token": token,
    "token_type": tokenType,
    "expires_in": expiresIn
  }
}


async function createUsersTableIfNotExists(req) {
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

async function createTokensTableIfNotExists(req) {
  const exists = await req.db.schema.hasTable('tokens');
  if (!exists) {
    await req.db.schema.createTable('tokens', function(table) {
      table.increments('id').primary();
      table.string("token");
      table.string("email");
      table.string("exp");
      table.timestamp('created_at').defaultTo(req.db.fn.now());
    });
  }

}


module.exports = router;
