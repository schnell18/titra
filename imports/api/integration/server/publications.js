import { check } from 'meteor/check'
import { Cards } from './wekan.js'
import { checkAuthentication } from '../../../utils/server_method_helpers.js'
import Projects from '../../projects/projects.js'

Meteor.publish('wekancards', function myCards(projectId) {
  check(projectId, String)
  checkAuthentication(this)

  const cardFilter = {
    $and: [{ archived: false }, {type: 'cardType-card'}],
  }
  const project = Projects.findOne({ _id: projectId })
  if (project?.wekanurl) {
    const boardId = project?.wekanurl?.match(/boards\/(.*)\/export\?/)[1]
    cardFilter.$and.push({ boardId: boardId })
  }

  return Cards.find(cardFilter)
})
