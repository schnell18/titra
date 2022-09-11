import { FlowRouter } from 'meteor/ostrio:flow-router-extra'
import './tasksearch2.html'
import { WekanCards } from '../../api/integration/cards.js'
import Timecards from '../../api/timecards/timecards.js'
import Projects from '../../api/projects/projects.js'

Template.tasksearch2.onCreated(function tasksearchcreated() {
  this.project = new ReactiveVar()
  this.tasks = new ReactiveVar()
  // this.lastTimecards = new ReactiveVar()
  this.autorun(() => {
    let tcid
    if (this.data.tcid && this.data.tcid.get()) {
      tcid = this.data.tcid.get()
    } else if (FlowRouter.getParam('tcid')) {
      tcid = FlowRouter.getParam('tcid')
    }
    if (tcid) {
      const handle = this.subscribe('singleTimecard', tcid)
      if (handle.ready()) {
        this.$('.js-tasksearch-input').val(Timecards.findOne({ _id: tcid }).task)
      }
    }
  })
  this.autorun(() => {
    if (FlowRouter.getParam('projectId')) {
      const project = Projects.findOne({ _id: FlowRouter.getParam('projectId') })
      if (project) {
        this.project.set(project)
        this.subscribe('wekancards', project._id)
      }
    }
  })

  this.autorun(() => {
    if (this.subscriptionsReady()) {
      const finalArray = []
      const regex = `.*${''}.*`

      const wekanResult = WekanCards.find({ title: { $regex: regex, $options: 'i' }, archived: false }, { sort: { lastUsed: -1 }, limit: 200})
      if (wekanResult.count() > 0) {
        finalArray.push(...wekanResult
          .map((elem) => ({ label: elem.title, value: elem._id, wekan: true })))
      }
      this.tasks.set(finalArray);

    }
  })
})
Template.tasksearch2.helpers({
  tasks: () => Template.instance()?.tasks.get(),
  displayTaskSelectionIcon: () => (Template.instance()?.data?.projectId
    ? Template.instance()?.data?.projectId?.get() : false),
})
