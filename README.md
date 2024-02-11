
# Movie Search Node REST API 

Welcome to the Movie Search Node REST API! This API provides endpoints for searching, filtering, and paginating through movie data in MySQL dabatase. It also includes user authentication using JWT tokens, HTTPS support, and Swagger documentation. The backend is built on Express.js and uses Knex.js for interacting with the database.


## Screenshots

![movie-api-project](https://github.com/cyrusnguyen/movie-api/assets/52537523/823e8632-d853-43f2-9733-7a6c1da8a895)


## Features

- Search movies based on keywords.
- Filter movies by various criteria.
- Paginate through movie results.
- User authentication using JWT tokens.
- HTTPS support for secure communication.
- Swagger documentation for API endpoints.


## Run Locally

Clone the project

```bash
  git clone https://github.com/cyrusnguyen/movie-api
```

Go to the project directory

```bash
  cd movie-api
```

Install dependencies

```bash
  npm install
```



Set up your environment variables. You may need to create a .env file with the following variables

```bash
    DATABASE_URL=<your_database_url>
    JWT_SECRET=<your_jwt_secret>
    PORT=<your_running_port>
```
Start the server

```bash
  npm start
```

The app should now be running locally



## Environment Variables

To run this project, you will need to add the following environment variables to your .env file

`JWT_SECRET`
`PORT`
`DATABASE_URL`


## Endpoints

#### Movies
- GET /movies/search: Retrieves a list of movies based on search criteria.
- GET /movies/data/{imdbID}: Get data for a movie by imdbID.
#### People
- GET /people/{id}: Get information about a person (actor, writer, director etc.) from their IMDB ID.
#### Authentication
- POST /user/register: Registers a new user.
- POST /user/login: Authenticates a user and generates a JWT token.
- POST /user/refresh: Refreshes the JWT token.
- POST /user/logout: Logs out the user.
- GET /user/{email}/profile: Retrieves the profile of a user identified by email.
- PUT /user/{email}/profile: Updates the profile of a user identified by email.
## Deployment

- The Movie Search REST API is deployed on Vercel. You can access the live version of the app at 
[movie-api-self.vercel.app](https://movie-api-self.vercel.app/)

- The MySQL database is deployed on PlanetScale. 

## Issues

If you encounter any issues or have suggestions for improvements, please open an issue on the GitHub repository.

Thank you for using the Movie Search Node REST API! Happy movie searching!
