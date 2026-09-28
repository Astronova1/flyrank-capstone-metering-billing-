const { app } = require('./app');
const { start: startWorker, start } = require('./worker');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, ()=> {
        console.log(`THE server is running on http://localhost:${PORT}`)
        startWorker();
    })