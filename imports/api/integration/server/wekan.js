import { Mongo, MongoInternals } from 'meteor/mongo'

let mongodbUrlWekan = ''
let mongodbUrlOplog = ''
if (process.env.NODE_ENV === 'development') {
  mongodbUrlWekan = "mongodb://localhost:3001/wekan", 
  mongodbUrlOplog = "mongodb://localhost:3001/local"
}
else {
  mongodbUrlWekan = process.env.WEKAN_MONGO_URL
  mongodbUrlOplog = mongodbUrlWekan.replace(/\/\w+\?/, '/local?')
}
const driver = new MongoInternals.RemoteCollectionDriver(
  mongodbUrlWekan, { oplogUrl: mongodbUrlOplog }
);
const Cards = new Mongo.Collection("cards", {_driver: driver});
const CustomFields = new Mongo.Collection("customFields", {_driver: driver});

export { Cards, CustomFields }

// vim: set sw=2 expandtab syntax=javascript:
