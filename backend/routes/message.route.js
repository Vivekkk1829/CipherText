const express= require('express')
const authMiddleware = require('../middlewares/auth.middleware')
const router = express.Router()
const {sendMessage,getMessages} = require('../controllers/message.controller.js')

router.post('/:userId',authMiddleware,sendMessage)
router.get('/:userId',authMiddleware,getMessages)


module.exports=router