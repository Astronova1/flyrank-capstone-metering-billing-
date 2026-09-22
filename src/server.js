const express = require('express')
const { pool } = require('./db')

const app = express()
app.use(express.json())

app.get('/health', async (req,res) =>{
    try{
        await pool.query('SELECT 1')
        res.json({status: 'ok', db: 'ok'})
    }
    catch{
        return res.status(503).json({status:'error', db:'Cant reach'})
    }
}) 

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, ()=> {
        console.log(`THE server is running on http://localhost:${PORT}`)
    })