var express = require('express');
var router = express.Router();
var bcrypt = require("bcrypt");
var jwt = require("jsonwebtoken");
const authorization = require('../middleware/authorization');

router.get("/:id", authorization, async function (req, res, next) {
  if (Object.keys(req.query).length > 0) {
    res.status(400).json({
      error: true,
      message: `Query parameters are not permitted.`,
    });
    return;
  }  

  const namesResult = await req.db.from('names as n').select({
    name: 'n.primaryName',
    birthYear: 'n.birthYear',
    deathYear: 'n.deathYear',
    titles: 'n.knownForTitles'
  }).where('n.nconst', '=', req.params.id).first();
  if (!namesResult) {
    res.status(404).json({
      error: true,
      message: `No record exists of a person with this ID`,
    });
    return;
  }
  const personName = namesResult.name;
  const personBirthYear = namesResult.birthYear || null;
  const personDeathYear = namesResult.deathYear || null;


  req.db.from('principals as p')
  .join('basics as b', function() {
    this.on('b.tconst', '=', 'p.tconst')
  })
  .select({
    movieName: 'b.primaryTitle', 
    movieId: 'b.tconst',
    imdbRating: 'b.imdbRating'
  }, {
    characters: 'p.characters',
    category: 'p.category'
  }
  ).where('p.nconst', '=', req.params.id)
  .then((rows) => {
    const data = [];
    rows.map((row) => {
      var characterArray = row.characters.trim() === "" ? "" : JSON.parse(row.characters);
      data.push({
        "movieName": row.movieName, 
        "movieId": row.movieId,
        "category": row.category,
        "characters": characterArray,
        "imdbRating": parseFloat(row.imdbRating) || null,
      })
    })
    console.log(rows.length, data.length)
    res.status(200).send( {
      "name": personName,
      "birthYear": personBirthYear,
      "deathYear": personDeathYear,
      "roles": data    } )
  })
  .catch((err) => {
    console.log(err);
    res.status(500).json({ "error": true, "message": "Database error"})
  })
});

module.exports = router;
