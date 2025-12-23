const dotenv = require("dotenv");
const connectDB = require("./db/index.js");
dotenv.config();
const app=require('./app.js')


connectDB()
  .then(() => {
    app.on("error", (error) => {
      console.log("ERR: ", error);
      throw error;
    });
    app.listen(process.env.PORT || 8000, () => {
      console.log(`App running sucessfully on PORT ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("MongoDB connection failed!!", err);
  });
