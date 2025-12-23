const mongoose = require('mongoose')

const connectDB= async()=>{
    try {
        await mongoose.connect(`${process.env.MONGODB_URI}/CipherData`)
        console.log("MongoDB Connected")
    } catch (error) {
        console.log("MongoDB Connection error ",error)
        process.exit(1)
    }
}

module.exports=connectDB