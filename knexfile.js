module.exports = {
    client: 'mysql2',
    connection: {
        host: '127.0.0.1',
        database: process.env.DB_NAME,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD
    }
}