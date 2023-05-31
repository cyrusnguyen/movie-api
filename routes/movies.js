var express = require('express');
var router = express.Router();
const authorization = require("../middleware/authorization");

router.get('/search', async function (req, res, next) {

  var page = parseInt(req.query.page) || 1;
  var per_page = parseInt(req.query.per_page) || 100;

  //check if there are existed invalid params
  if (!isNaN(req.query.year) && isNaN(parseInt(req.query.year))) {
    res.status(400).json({
      error: true,
      message: `Invalid year format. Format must be yyyy.`,
    });
  } else {
    var offset = (page - 1) * per_page;
    var count = await req.db('basics')
    .where("primaryTitle", "like", `%${req.query.title || ''}%`)
    .where("year", "like", `%${req.query.year || ''}%`).count("* as total").first();

    req.db.from('basics').select("primaryTitle","year","tconst","imdbRating","rottenTomatoesRating","metacriticRating","rated")
    .where("primaryTitle", "like", `%${req.query.title || ''}%`)
    .where("year", "like", `%${req.query.year || ''}%`)
    .limit(per_page).offset(offset)
      .then((rows) => {
        const data = rows.map((row) => {
          return {
            "title": row.primaryTitle,
            "year": parseInt(row.year) || null,
            "imdbID": row.tconst,
            "imdbRating": parseInt(row.imdbRating) || null,
            "rottenTomatoesRating": parseInt(row.rottenTomatoesRating) || null,
            "metacriticRating": parseInt(row.metacriticRating) || null,
            "classification": row.rated,
          }
        });
        res.status(200).json({ "data": data, "pagination": {
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
  if (Object.keys(req.query).length > 0) {
    res.status(400).json({
      error: true,
      message: `Invalid query parameters: ${Object.keys(req.query).join(",")}. Query parameters are not permitted`,
    });
  }
  req.db.from('basics as b')
  .join('principals as p', 'b.tconst', 'p.tconst')
  .join('ratings as r', 'b.tconst', 'r.tconst')
  .select({
    title: 'b.primaryTitle',
    year: 'b.year',
    runtime: 'b.runtimeMinutes',
    genres: 'b.genres',
    country: 'b.country',
    boxoffice: 'b.boxoffice',
    poster: 'b.poster',
    plot:'b.plot'
  }, {
    id: 'p.nconst', 
    category:'p.category', 
    name:'p.name', 
    characters: 'p.characters'
  }, 'r.source', 'r.value')
  .where('b.tconst', '=', req.params.id).groupBy('b.tconst','p.nconst', 'p.name', 'p.category', 'p.characters', 'r.source', 'r.value')
  .then((rows) => {const result = rows.reduce((acc, row) => {
    const { title, year, runtime, country, boxoffice, poster, plot, id, category, name, source, value} = row;
    const genres = row.genres.split(',') ;
    const characters = row.characters.trim() === "" ? "" : JSON.parse(row.characters);

    if (!acc.principals.some((p) => p.id === id)) {
    acc.principals.push({ id, category, name, characters });
    }
    if (!acc.ratings.some((r) => r.source === source)) {
    acc.ratings.push({ source, value });
    }
   
    
    acc = {
      title,
      year,
      runtime,
      genres,
      country,
      principals: acc.principals,
      ratings: acc.ratings,
      boxoffice,
      poster,
      plot
    };
   
    return acc;
    }, {principals:[], ratings:[]});
  
      res.status(200).json( result )
      
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ "error": true, "message": "Database error"})
    })
});


module.exports = router;
