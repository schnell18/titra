import { Match, check } from 'meteor/check'
import { getJson } from './bodyparser'
import { insertTimeCard, upsertTimecard } from '../imports/api/timecards/methods'
import Timecards from '../imports/api/timecards/timecards'
import Projects from '../imports/api/projects/projects'
import { Cards } from '../imports/api/integration/server/wekan.js'

function sendResponse(res, statusCode, message, payload) {
  const response = {}
  response.statusCode = statusCode
  response.message = message
  if (payload) {
    response.payload = payload
  }
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  })
  res.end(JSON.stringify(response))
}
function checkAuthorization(req, res) {
  const authHeader = req.headers.authorization
  console.log("authHeader => ".concat(authHeader));
  if (authHeader) {
    const meteorUser = Meteor.users.findOne({ 'profile.APItoken': authHeader.split(' ')[1] })
    console.log("meteorUser => ".concat(meteorUser));
    if (meteorUser) {
      return meteorUser
    }
  }
  sendResponse(res, 401, 'Missing authorization header or invalid authorization token supplied.')
  return false
}
/**
 * @apiDefine AuthError
 * @apiError {json} AuthError The request is missing the authentication header or an invalid API token has been provided.
 * @apiErrorExample {json} Authorization-Error-Response:
 *     HTTP/1.1 401 Unauthorized
 *     {
 *       "message": "Missing authorization header or invalid authorization token supplied."
 *     }
 */

/**
 * @api {post} /timeentry/create Create time entry
 * @apiName createTimeEntry
 * @apiDescription Create a new time entry for the user assigned to the provided API token
 * @apiGroup TimeEntry
 *
 * @apiHeader {String} Token The authorization header Bearer API token.
 * @apiParam {String} projectId The project ID.
 * @apiParam {String} task The task description of the new time entry.
 * @apiParam {Date} date The date for the new time entry in format YYYY-MM-DD.
 * @apiParam {Number} hours The number of hours to track.
 * @apiParamExample {json} Request-Example:
 *                  {
 *                    "projectId": "123456",
 *                    "task": "Work done.",
 *                    "date": "2019-11-10",
 *                    "hours": 8
 *                  }
 * @apiSuccess {json} The id of the new time entry.
 * @apiSuccessExample {json} Success response:
 * {
 *  message: "time entry created."
 *  payload: {
 *    timecardId: "123456"
 *  }
 *  }
 * @apiUse AuthError
 */
WebApp.connectHandlers.use('/timeentry/create/', async (req, res, next) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const json = await getJson(req).catch((e) => {
    sendResponse(res, 400, `Invalid JSON received. ${e}`)
  })
  if (json) {
    try {
      check(json.projectId, String)
      check(json.task, String)
      check(new Date(json.date), Date)
      check(json.hours, Number)
    } catch (error) {
      sendResponse(res, 500, `Invalid parameters received.${error}`)
      return
    }
    const timecardId = insertTimeCard(json.projectId, json.task, new Date(json.date), json.hours, meteorUser._id)
    const payload = {}
    payload.timecardId = timecardId
    sendResponse(res, 200, 'Time entry created.', payload)
    return
  }
  sendResponse(res, 500, 'Missing mandatory parameters.')
})

/**
  * @api {get} /timeentry/list/:date Get time entries for date
  * @apiDescription Create a new time entry for the user assigned to the provided API token
  * @apiName getTimeEntriesForDate
  * @apiGroup TimeEntry
  *
  * @apiHeader {String} Token The authorization header Bearer API token.
  * @apiParam {Date} date The date to list time entries for in format YYYY-MM-DD.

  * @apiSuccess {json} response An array of time entries tracked for the user with the provided API token
  * for the provided date.
  * @apiUse AuthError
  */
WebApp.connectHandlers.use('/timeentry/list/', async (req, res, next) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const url = req._parsedUrl.pathname.split('/')
  const date = new Date(url[3])
  try {
    check(date, Date)
  } catch (error) {
    sendResponse(res, 500, `Invalid parameters received.${error}`)
    return
  }
  const payload = Timecards.find({
    userId: meteorUser._id,
    date,
  }).fetch()
  sendResponse(res, 200, `Returning user time entries for date ${date}`, payload)
})

/**
   * @api {get} /project/list/ Get all projects
   * @apiDescription Lists all projects visible to the user assigned to the provided API token
   * @apiName getProjects
   * @apiGroup Project
   *
   * @apiHeader {String} Token The authorization header Bearer API token.
   * @apiSuccess {json} response An array of all projects visible for the user with the provided API token.
   * @apiUse AuthError
   */
WebApp.connectHandlers.use('/project/list/', async (req, res, next) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const payload = Projects.find({
    $or: [{ userId: meteorUser._id }, { public: true }, { team: meteorUser._id }],
  }).fetch()
  sendResponse(res, 200, 'Returning projects', payload)
})

/**
   * @api {post} /project/create/ Create a new project
   * @apiDescription Creates a new titra project based on the parameters provided
   * @apiName CreateProject
   * @apiGroup Project
   *
   * @apiHeader {String} Token The authorization header Bearer API token.
   * @apiParam {String} name The project name.
   * @apiParam {String} [description] The description of the project.
   * @apiParam {String} [color] The project color in HEX color code.
   * @apiParam {String} [customer] The customer of the project.
   * @apiParam {Number} [rate] The hourly rate of the project.
   * @apiParam {Number} [budget] The budget for this project in hours.

   * @apiParamExample {json} Request-Example:
   *                  {
   *                    "name": "Project A",
   *                    "description": "This is the description of Project A.",
   *                    "color": "#009688",
   *                    "customer": "Paying customer",
   *                    "rate": 100,
   *                    "budget": 50
   *                  }
   * @apiSuccess {json} response The id of the new project.
   *  * @apiSuccessExample {json} Success response:
    * {
    *  message: "time entry created."
    *  payload: {
    *    projectId: "123456"
    *  }
    *  }
   * @apiUse AuthError
   */
WebApp.connectHandlers.use('/project/create/', async (req, res, next) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const json = await getJson(req).catch((e) => {
    sendResponse(res, 400, `Invalid JSON received. ${e}`)
  })
  if (json) {
    try {
      check(json.name, String)
      check(json.description, Match.Maybe(String))
      check(json.color, Match.Maybe(String))
      check(json.customer, Match.Maybe(String))
      check(json.rate, Match.Maybe(Number))
      check(json.budget, Match.Maybe(Number))
    } catch (error) {
      sendResponse(res, 500, `Invalid parameters received.${error}`)
      return
    }
    json.userId = meteorUser._id
    const projectId = Projects.insert(json)
    const payload = {}
    payload.projectId = projectId
    sendResponse(res, 200, 'Project created.', payload)
  }
})
/**
   * @api {post} /timer/start/ Start a new timer
   * @apiDescription Starts a new timer for the API user if there is no current running timer.
   * @apiName startTimer
   * @apiGroup TimeEntry
   *
   * @apiHeader {String} Token The authorization header Bearer API token.
   * @apiSuccess {json} response If there is no current running timer a new one will be started.
   *  * @apiSuccessExample {json} Success response:
    * {
    *  message: "New timer started."
    *  payload: {
    *    "startTime": "Sat Jun 26 2021 21:48:11 GMT+0200"
    *  }
    * }
   * @apiError {json} response There is already another running timer.
    *      @apiErrorExample {json} Error-Response:
    *     HTTP/1.1 500 Internal Server Error
    *     {
    *       "message": "There is already another running timer."
    *     }
   * @apiUse AuthError
   */
WebApp.connectHandlers.use('/timer/start/', async (req, res, next) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const payload = {}
  if (!meteorUser.profile.timer) {
    payload.startTime = meteorUser.profile.timer
    Meteor.users.update({ _id: meteorUser._id }, { $set: { 'profile.timer': new Date() } })
    sendResponse(res, 200, 'New timer started.', payload)
  } else {
    sendResponse(res, 500, 'There is already another running timer.')
  }
})

/**
   * @api {get} /timer/get/ Get the duration of the current timer
   * @apiDescription Get the duration in milliseconds and the start timestamp of the currently running timer for the API user.
   * @apiName getTimer
   * @apiGroup TimeEntry
   *
   * @apiHeader {String} Token The authorization header Bearer API token.
   * @apiSuccess {json} response Returns the duration of the currently running timer.
   *  * @apiSuccessExample {json} Success response:
    * {
    *  message: "Running timer received."
    *  payload: {
    *    "duration": 60000,
    *    "startTime": "Sat Jun 26 2021 21:48:11 GMT+0200"
    *  }
    * }
   * @apiError {json} response There is no running timer.
    *      @apiErrorExample {json} Error-Response:
    *     HTTP/1.1 500 Internal Server Error
    *     {
    *       "message": "No running timer found."
    *     }
   * @apiUse AuthError
   */
WebApp.connectHandlers.use('/timer/get/', async (req, res, next) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const payload = {}
  if (meteorUser.profile.timer) {
    payload.startTime = meteorUser.profile.timer
    const currentTime = new Date()
    const timerTime = new Date(meteorUser.profile.timer)
    payload.duration = currentTime.getTime() - timerTime.getTime()
    sendResponse(res, 200, 'Running timer received.', payload)
  } else {
    sendResponse(res, 500, 'No running timer found.')
  }
})
/**
   * @api {post} /timer/stop/ Stop a running timer
   * @apiDescription Stop a running timer of the API user and return the start timestamp and duration in milliseconds.
   * @apiName stopTimer
   * @apiGroup TimeEntry
   *
   * @apiHeader {String} Token The authorization header Bearer API token.
   * @apiSuccess {json} response Returns the duration in milliseconds and the start timestamp of the stopped timer as result.
   *  * @apiSuccessExample {json} Success response:
    * {
    *  message: "Running timer stopped."
    *  payload: {
    *    "duration": 60000,
    *    "startTime": "Sat Jun 26 2021 21:48:11 GMT+0200"
    *  }
    * }
  * @apiError {json} response No running timer to stop.
    *      @apiErrorExample {json} Error-Response:
    *     HTTP/1.1 500 Internal Server Error
    *     {
    *       "message": "No running timer found."
    *     }
   * @apiUse AuthError
   */
WebApp.connectHandlers.use('/timer/stop/', async (req, res, next) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const payload = {}
  if (meteorUser.profile.timer) {
    payload.startTime = meteorUser.profile.timer
    const currentTime = new Date()
    const timerTime = new Date(meteorUser.profile.timer)
    payload.duration = currentTime.getTime() - timerTime.getTime()
    Meteor.users.update({ _id: meteorUser._id }, { $unset: { 'profile.timer': '' } })
    sendResponse(res, 200, 'Running timer stopped.', payload)
  } else {
    sendResponse(res, 500, 'No running timer found.')
  }
})

// TODO: remove this temporary workaround
WebApp.connectHandlers.use('/timecard/fix/', async (req, res, _) => {
  const meteorUser = checkAuthorization(req, res)
  if (!meteorUser) {
    return
  }
  const payload = {}
  const unmatched = [];
  // find all timecard without cardId
  Timecards.find({cardId: {$exists: false}}).forEach(t => {
    let boardId = null

    const project = Projects.findOne({ _id: t.projectId })
    if (project?.wekanurl) {
      boardId = project?.wekanurl?.match(/boards\/(.*)\/export\?/)[1]
    }
    if (boardId) {
      const card = Cards.findOne({title: t.task, boardId: boardId})
      if (card) {
        upsertTimecard(t.projectId, t.task, card._id, t.date, t.hours, t.userId)
      }
      else {
        unmatched.push({
          id: t._id,
          task: t.task
        })
      }
    }
    else {
      unmatched.push({
        id: t._id,
        task: t.task
      })
    }
  });

  if (unmatched.length > 0) {
    payload.unmatches = unmatched
  }
  sendResponse(res, 200, 'Data fixed', payload)
})
