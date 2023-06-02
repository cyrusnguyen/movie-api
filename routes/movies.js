var express = require('express');
var router = express.Router();
const authorization = require("../middleware/authorization");

router.get('/search', async function (req, res, next) {

  var page = parseInt(req.query.page) || 1;
  var per_page = parseInt(req.query.per_page) || 100;

  //check if there are existed invalid params
  if (/[^0-9]/.test(req.query.year) && req.query.year !== undefined) {
    res.status(400).json({
      error: true,
      message: 'Invalid year format. Format must be yyyy.',
    });
    return;
  } else if (/[^0-9]/.test(req.query.page) && req.query.page !== undefined){
    res.status(400).json({
      error: true,
      message: `Invalid page format. page must be a number.`,
    });
    return;
  }else {
    var offset = (page - 1) * per_page;
    
    var count = await req.db('basics')
    .where("primaryTitle", "like", `%${req.query.title || ''}%`)
    .where("year", "like", `%${req.query.year || ''}%`).count("* as total").first();
    var prevPage = page > 1 ? page - 1 : null;
    var nextPage = page < Math.ceil(count.total / per_page) ? page + 1 : null;
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
            "imdbRating": parseFloat(row.imdbRating) || null,
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
          prevPage: prevPage,
          nextPage: nextPage,
          from: offset,
          to: offset + rows.length,
          

        },
      })
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ "error": true, "message": "Database error"})
      });
  }

  
});


router.get("/data/:id", async function (req, res, next) {
  if (Object.keys(req.query).length > 0) {
    res.status(400).json({
      error: true,
      message: `Query parameters are not permitted.`,
    });
    return;
  }

  const ratingsResult = await req.db.from('ratings as r').select('r.source', 'r.value').where('r.tconst', '=', req.params.id)
  const ratingsObj = ratingsResult.map((result) => {
    var regex = /(\d+(?:\.\d+)?)/g;
    var filteredValue = parseFloat(result.value.match(regex)) || null;
    return { source: result.source, value: filteredValue }
  })

  const principalsResult = await req.db.from('principals as p').select({
    id: 'p.nconst', 
    category:'p.category', 
    name:'p.name', 
    characters: 'p.characters'
  }).where('p.tconst', '=', req.params.id)
  const principalsObj = principalsResult.map((result) => {
    var filteredCharacters = result.characters.trim() === "" ? "" : JSON.parse(result.characters);
    
    return {
      "id": result.id,
      "category": result. category,
      "name": result.name,
      "characters": filteredCharacters
    }
  })

  req.db.from('basics as b')
  .select({
    title: 'b.primaryTitle',
    year: 'b.year',
    runtime: 'b.runtimeMinutes',
    genres: 'b.genres',
    country: 'b.country',
    boxoffice: 'b.boxoffice',
    poster: 'b.poster',
    plot:'b.plot'
  })
  .where('b.tconst', '=', req.params.id).first()
  .then((rows) => {
      if (!rows){
        res.status(404).json({ "error": true, "message": "No movies found."});
        return;
      }
      var result = {
        "title": rows.title,
        "year": rows.year,
        "runtime": rows.runtime,
        "genres": rows.genres.split(','),
        "country": rows.country,
        "principals": principalsObj,
        "ratings": ratingsObj,
        "boxoffice": rows.boxoffice,
        "poster": rows.poster,
        "plot": rows.plot
      }
  
    res.status(200).json( result )
    return;
    
  })
  .catch((err) => {
    console.log(err);
    res.status(500).json({ "error": true, "message": "Database error"})
  })
});


module.exports = router;
