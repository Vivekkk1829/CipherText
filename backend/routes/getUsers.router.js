const express=require('express')
const { getUsers } = require('../controllers/getUsers.controller')
const authMiddleware = require('../middlewares/auth.middleware')
const router=express.Router()

router.get('/getUsers',authMiddleware,getUsers)

module.exports = router