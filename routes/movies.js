var express = require('express');
var router = express.Router();
const authorization = require("../middleware/authorization");

router.get('/search', async function (req, res, next) {
  const movies = [];
  var page = parseInt(req.query.page) || 1;
  var per_page = parseInt(req.query.per_page) || 10;

  //check if there are existed invalid params
  if (!page || !per_page) {
    res.status(400).json({
      error: true,
      message: `Invalid query parameters`,
    });
  } else {
    var offset = (page - 1) * per_page;
    var count = await req.db.from('basics').count('* as total').first();

    req.db.from('basics').select("*").limit(per_page).offset(offset)
      .then((rows) => {
        rows.map((data) => movies.push(data.country));
        res.status(200).json({ "error": false, "message": "Success", "data": rows, "pagination": {
          total: count.total,
          lastPage: Math.ceil(count.total / per_page),
          perPage: per_page,
          currentPage: page,
          from: offset,
          to: offset + rows.length

        },
      })
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ "error": true, "message": "Database error"})
      });
  }

  
});


router.get("/data/:id", function (req, res, next) {
  if(!id){
    res.status(400).json({
      error: true,
      message: `Invalid query parameters: ${id}. Query parameters are not permitted`,
    });
  }
  req.db.from('basics').select('*').where('id', '=', req.params.id)
    .then((rows) => {
      res.json({ "error": false, "message": "Success", "data": rows })
    })
    .catch((err) => {
      console.log(err);
      res.json({ "error": true, "message": "Error executing MySQL query" })
    })
});

// router.post('/api/update', authorization, (req, res) => {
//   if (!req.body.City || !req.body.CountryCode || !req.body.Pop) {
//     res.status(400).json({ message: `Error updating population` });
//     console.log(`Error on request body:`, JSON.stringify(req.body));

//   } else {
//     const filter = {
//       "Name": req.body.City,
//       "CountryCode": req.body.CountryCode
//     };
//     const pop = {
//       "Population": req.body.Pop
//     };
//     req.db('city').where(filter).update(pop)
//       .then(_ => {
//         res.status(201).json({ message: `Successful update ${req.body.City}` });
//         console.log(`successful population update:`, JSON.stringify(filter));
//       }).catch(error => {
//         res.status(500).json({ message: 'Database error - not updated' });
//       });
//   }
// });

module.exports = router;
