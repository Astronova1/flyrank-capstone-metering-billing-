const { app } = require('./app');
const { start: startWorker, start } = require('./worker');
const { migrate } = require('./migrate')

    const PORT = process.env.PORT || 3000;
    migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      startWorker();
    });
  })
  .catch((err) => {
    console.error('startup failed:', err);
    process.exit(1);
  });