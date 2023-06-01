var express = require('express');
var router = express.Router();
var bcrypt = require("bcrypt");
var jwt = require("jsonwebtoken");
const authorization = require('../middleware/authorization');

router.get("/:id", async function (req, res, next) {
  if (Object.keys(req.query).length > 0) {
    res.status(400).json({
      error: true,
      message: `Invalid query parameters: ${Object.keys(req.query).join(",")}. Query parameters are not permitted`,
    });
  }  
  // .join('principals as p', 'b.tconst', 'p.tconst')
  // .join('ratings as r', 'b.tconst', 'r.tconst')
  const namesResult = await req.db.from('names as n').select({
    name: 'n.primaryName',
    birthYear: 'n.birthYear',
    deathYear: 'n.deathYear',
    titles: 'n.knownForTitles'
  }).where('n.nconst', '=', req.params.id)
  if (namesResult.length === 0){
    res.status(404).json({
      error: true,
      message: `No record exists of a person with this ID`,
    });
  }
  const titleArray = namesResult[0].titles.split(',') || null;
  const personName = namesResult[0].name;
  const personBirthYear = namesResult[0].birthYear || null;
  const personDeathYear = namesResult[0].deathYear || null;

  req.db.from('basics as b')
  .join('principals as p', function() {
    this.on('b.tconst', '=', 'p.tconst')
    this.onIn('p.name', personName)
  })
  .select({
    movieName: 'b.primaryTitle', 
    movieId: 'b.tconst',
    imdbRating: 'b.imdbRating'
  }, {
    characters: 'p.characters',
    category: 'p.category'
  })
  .whereIn('b.tconst', titleArray)
  .then((rows) => {
    const data = [];
    rows.map((row) => {
      var characterArray = row.characters.trim() === "" ? "" : JSON.parse(row.characters)
      data.push({
        "movieName": row.movieName, 
        "movieId": row.movieId,
        "category": row.category,
        "characters": characterArray,
        "imdbRating": parseFloat(row.imdbRating) || null,
      })
    })
    res.status(200).send( {
      "name": personName,
      "birthYear": personBirthYear,
      "deathYear": personDeathYear,
      "roles": data
    } )
    
  })
  .catch((err) => {
    console.log(err);
    res.status(500).json({ "error": true, "message": "Database error"})
  })
});

module.exports = router;
