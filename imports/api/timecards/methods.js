import dayjs from 'dayjs'
import { NodeVM } from 'vm2'
import { fetch } from 'meteor/fetch'
import { check, Match } from 'meteor/check'
import { Promise } from 'meteor/promise'
import Timecards from './timecards.js'
import Tasks from '../tasks/tasks.js'
import Projects from '../projects/projects.js'
import { t } from '../../utils/i18n.js'
import { emojify, getGlobalSetting } from '../../utils/frontend_helpers'
import { timeInUserUnit } from '../../utils/periodHelpers.js'
import {
  checkAuthentication,
  buildTotalHoursForPeriodSelector,
  buildDailyHoursSelector,
  buildworkingTimeSelector,
  workingTimeEntriesMapper,
  buildDetailedTimeEntriesForPeriodSelector,
} from '../../utils/server_method_helpers.js'

function checkTimeEntryRule({
  userId, projectId, task, state, date, hours,
}) {
  const vm = new NodeVM({
    wrapper: 'none',
    timeout: 1000,
    sandbox: {
      user: Meteor.users.findOne({ _id: userId }).profile,
      project: Projects.findOne({ _id: projectId }),
      dayjs,
      timecard: {
        projectId,
        task,
        state,
        date,
        hours,
      },
    },
  })
  try {
    if (!vm.run(getGlobalSetting('timeEntryRule'))) {
      throw new Meteor.Error('notifications.time_entry_rule_failed')
    }
  } catch (error) {
    throw new Meteor.Error(error.message)
  }
}
function insertTimeCard(projectId, task, taskId, date, hours, userId, customfields) {
  const newTimeCard = {
    userId,
    projectId,
    date,
    hours,
    task: task.replace(/(:\S*:)/g, emojify),
    taskId: taskId,
    ...customfields,
  }
  if (!Tasks.findOne({ userId, name: task.replace(/(:\S*:)/g, emojify) })) {
    Tasks.insert({
      userId, lastUsed: new Date(), name: task.replace(/(:\S*:)/g, emojify), taskId: taskId, ...customfields,
    })
  } else {
    Tasks.update({ userId, name: task.replace(/(:\S*:)/g, emojify) }, { $set: { lastUsed: new Date(), ...customfields } })
  }
  return Timecards.insert(newTimeCard)
}
function upsertTimecard(projectId, task, taskId, date, hours, userId) {
  if (!Tasks.findOne({ userId, name: task.replace(/(:\S*:)/g, emojify) })) {
    Tasks.insert({ userId, lastUsed: new Date(), name: task.replace(/(:\S*:)/g, emojify), taskId: taskId })
  } else {
    Tasks.update({ userId, name: task.replace(/(:\S*:)/g, emojify) }, { $set: { lastUsed: new Date() } })
  }
  if (hours === 0) {
    Timecards.remove({
      userId,
      projectId,
      date,
      task: task.replace(/(:\S*:)/g, emojify),
    })
  } else if (Timecards.find({
    userId,
    projectId,
    date,
    task: task.replace(/(:\S*:)/g, emojify),
  }).count() > 1) {
    // if there are more time entries with the same task description for one day,
    // we remove all of them and create a new entry for the total sum
    Timecards.remove({
      userId,
      projectId,
      date,
      task: task.replace(/(:\S*:)/g, emojify),
    })
  }
  return Timecards.update(
    {
      userId,
      projectId,
      date,
      task: task.replace(/(:\S*:)/g, emojify),
    },
    {
      userId,
      projectId,
      date,
      hours,
      task: task.replace(/(:\S*:)/g, emojify),
      taskId: taskId,
    },

    { upsert: true },
  )
}

Meteor.methods({
  insertTimeCard({
    projectId,
    task,
    taskId,
    date,
    hours,
    customfields,
  }) {
    check(projectId, String)
    check(task, String)
    check(taskId, String)
    check(date, Date)
    check(hours, Number)
    check(customfields, Match.Maybe(Object))
    checkAuthentication(this)
    checkTimeEntryRule({
      userId: this.userId, projectId, task, state: 'new', date, hours,
    })
    insertTimeCard(projectId, task, taskId, date, hours, this.userId, customfields)
  },
  upsertWeek(weekArray) {
    checkAuthentication(this)
    check(weekArray, Array)
    weekArray.forEach((element) => {
      check(element.projectId, String)
      check(element.task, String)
      check(element.taskId, String)
      check(element.date, Date)
      check(element.hours, Number)
      checkTimeEntryRule({
        userId: this.userId,
        projectId: element.projectId,
        task: element.task,
        state: 'new',
        date: element.date,
        hours: element.hours,
      })
      upsertTimecard(element.projectId, element.task, element.taskId, element.date, element.hours, this.userId)
    })
  },
  updateTimeCard({
    projectId,
    _id,
    task,
    taskId,
    date,
    hours,
    customfields,
  }) {
    check(projectId, String)
    check(_id, String)
    check(task, String)
    check(taskId, String)
    check(date, Date)
    check(hours, Number)
    check(customfields, Match.Maybe(Object))
    checkAuthentication(this)
    const timecard = Timecards.findOne({ _id })
    checkTimeEntryRule({
      userId: this.userId, projectId, task, state: timecard.state, date, hours,
    })
    if (!Tasks.findOne({ userId: this.userId, name: task.replace(/(:\S*:)/g, emojify) })) {
      Tasks.insert({ userId: this.userId, name: task.replace(/(:\S*:)/g, emojify), ...customfields })
    }
    Timecards.update({ _id }, {
      $set: {
        projectId,
        date,
        hours,
        task: task.replace(/(:\S*:)/g, emojify),
        ...customfields,
      },
    })
  },
  deleteTimeCard({ timecardId }) {
    checkAuthentication(this)
    const timecard = Timecards.findOne({ _id: timecardId })
    checkTimeEntryRule({
      userId: this.userId,
      projectId: timecard.projectId,
      task: timecard.task,
      state: timecard.state,
      date: timecard.date,
      hours: timecard.hours,
    })
    return Timecards.remove({ userId: this.userId, _id: timecardId })
  },
  sendToSiwapp({
    projectId, timePeriod, userId, customer, dates,
  }) {
    check(projectId, Match.OneOf(String, Array))
    check(timePeriod, String)
    check(userId, Match.OneOf(String, Array))
    check(customer, Match.OneOf(String, Array))
    checkAuthentication(this)
    const meteorUser = Meteor.users.findOne({ _id: this.userId })
    if (!meteorUser.profile.siwappurl || !meteorUser.profile.siwapptoken) {
      throw new Meteor.Error(t('notifications.siwapp_configuration'))
    }
    if (timePeriod === 'custom') {
      check(dates, Object)
      check(dates.startDate, Date)
      check(dates.endDate, Date)
    }
    checkAuthentication(this)
    const timeEntries = []
    const selector = buildDetailedTimeEntriesForPeriodSelector({
      projectId,
      search: undefined,
      customer,
      period: timePeriod,
      dates,
      userId,
      limit: undefined,
      page: undefined,
      sort: undefined,
    })
    const projectMap = new Map()
    for (const timecard of Timecards.find(selector[0]).fetch()) {
      timeEntries.push(timecard._id)
      const resource = Meteor.users.findOne({ _id: timecard.userId }).profile.name
      const projectEntry = projectMap.get(timecard.projectId)
      if (projectEntry) {
        projectEntry.set(
          resource,
          (projectEntry.get(resource) ? projectEntry.get(resource) : 0) + timecard.hours,
        )
      } else {
        projectMap.set(timecard.projectId, new Map().set(resource, timecard.hours))
      }
    }
    const invoiceJSON = {
      data: {
        attributes: {
          name: 'from titra',
          issue_date: dayjs().format('YYYY-MM-DD'),
          draft: true,
        },
        relationships: {
          items: {
            data: [],
          },
        },
      },
    }
    projectMap.forEach((resources, project) => {
      if (resources.size > 0) {
        resources.forEach((hours, resource) => {
          invoiceJSON.data.relationships.items.data.push({
            attributes: {
              description: `${Projects.findOne({ _id: project }).name} (${resource})`,
              quantity: timeInUserUnit(hours, meteorUser),
              unitary_cost: 0,
            },
          })
        })
      }
    })
    return fetch(`${meteorUser.profile.siwappurl}/api/v1/invoices`, {
      method: 'POST',
      body: JSON.stringify(invoiceJSON),
      headers: {
        Authorization: `Token token=${meteorUser.profile.siwapptoken}`,
        'Content-type': 'application/json',
      },
    }).then((response) => {
      if (response.status === 201) {
        Timecards.update({ _id: { $in: timeEntries } }, { $set: { state: 'billed' } }, { multi: true })
        return 'notifications.siwapp_success'
      }
      return 'notifications.siwapp_configuration'
    }).catch((error) => {
      console.error(error)
      throw new Meteor.Error(error)
    })
  },
  getDailyTimecards({
    projectId,
    userId,
    period,
    dates,
    customer,
    limit,
    page,
  }) {
    check(projectId, Match.OneOf(String, Array))
    check(period, String)
    check(userId, String)
    if (period === 'custom') {
      check(dates, Object)
      check(dates.startDate, Date)
      check(dates.endDate, Date)
    }
    check(customer, String)
    check(limit, Number)
    check(page, Match.Maybe(Number))
    checkAuthentication(this)
    const aggregationSelector = buildDailyHoursSelector(
      projectId,
      period,
      dates,
      userId,
      customer,
      limit,
      page,
    )
    const dailyHoursObject = {}
    const totalEntries = Promise.await(Timecards.rawCollection()
      .aggregate(buildDailyHoursSelector(projectId, period, dates, userId, customer, 0))
      .toArray()).length
    const dailyHours = Promise.await(Timecards.rawCollection().aggregate(aggregationSelector)
      .toArray())
    dailyHoursObject.dailyHours = dailyHours
    dailyHoursObject.totalEntries = totalEntries
    return dailyHoursObject
  },
  getTotalHoursForPeriod({
    projectId,
    userId,
    period,
    dates,
    customer,
    limit,
    page,
  }) {
    check(projectId, Match.OneOf(String, Array))
    check(period, String)
    if (period === 'custom') {
      check(dates, Object)
      check(dates.startDate, Date)
      check(dates.endDate, Date)
    }
    check(userId, String)
    check(customer, String)
    check(limit, Number)
    check(page, Match.Maybe(Number))
    checkAuthentication(this)
    const aggregationSelector = buildTotalHoursForPeriodSelector(
      projectId,
      period,
      dates,
      userId,
      customer,
      limit,
      page,
    )
    const totalHoursObject = {}
    const totalEntries = Promise.await(Timecards.rawCollection()
      .aggregate(buildTotalHoursForPeriodSelector(projectId, period, dates, userId, customer, 0))
      .toArray()).length
    const totalHours = Promise.await(Timecards.rawCollection().aggregate(aggregationSelector)
      .toArray())
    for (const entry of totalHours) {
      entry.totalHours = Number(JSON.parse(JSON.stringify(entry)).totalHours.$numberDecimal)
    }
    totalHoursObject.totalHours = totalHours
    totalHoursObject.totalEntries = totalEntries
    return totalHoursObject
  },
  getWorkingHoursForPeriod({
    projectId,
    userId,
    period,
    dates,
    limit,
    page,
  }) {
    checkAuthentication(this)
    check(projectId, Match.OneOf(String, Array))
    check(period, String)
    if (period === 'custom') {
      check(dates, Object)
      check(dates.startDate, Date)
      check(dates.endDate, Date)
    }
    check(userId, String)
    check(limit, Number)
    check(page, Match.Maybe(Number))
    const aggregationSelector = buildworkingTimeSelector(
      projectId,
      period,
      dates,
      userId,
      limit,
      page,
    )
    const totalEntries = Promise.await(
      Timecards.rawCollection()
        .aggregate(buildworkingTimeSelector(projectId, period, dates, userId, 0)).toArray(),
    ).length
    const workingHoursObject = {}
    workingHoursObject.totalEntries = totalEntries
    const workingHours = Promise.await(Timecards.rawCollection().aggregate(aggregationSelector)
      .toArray()).map(workingTimeEntriesMapper)
    workingHoursObject.workingHours = workingHours
    return workingHoursObject
  },
  setTimeEntriesState({ timeEntries, state }) {
    checkAuthentication(this)
    check(state, String)
    check(timeEntries, Array)
    for (const timeEntryId of timeEntries) {
      check(timeEntryId, String)
    }
    if (state === 'exported') {
      Timecards.update({ _id: { $in: timeEntries }, state: { $in: ['new', undefined] } }, { $set: { state } }, { multi: true })
    } else if (state === 'billed') {
      Timecards.update({ _id: { $in: timeEntries }, state: { $ne: 'notBillable' } }, { $set: { state } }, { multi: true })
    } else {
      Timecards.update({ _id: { $in: timeEntries } }, { $set: { state } }, { multi: true })
    }
  },
})

export { insertTimeCard }
