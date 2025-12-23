const express = require('express')
const app = express()
const authRouter=require('./routes/auth.router.js')
const cors = require('cors')
const cookieParser = require("cookie-parser");

app.use(cookieParser());
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());


app.get('/',(req,res)=>{
    res.send("Hello World")
})

app.use('/api/auth',authRouter)




module.exports=app