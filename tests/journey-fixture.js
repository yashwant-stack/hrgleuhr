import {activeTraining} from '../phase-training.js';
export function completeMentorFixture(t,db){t.mentor={userId:db.users[0]?.id,phase:t.stage,fixture:true,tasks:activeTraining(t,db).checklist.filter(r=>!r.removed&&r.type==='Practical').map(r=>({topicId:r.id,complete:true}))};}
import {journeySteps,journeyMutationStep} from '../journey.js';
// Existing endpoint regression suites exercise actions independently. Seed their
// prerequisite journey sign-offs; sequential-journey.test.js tests the real gates.
// Never override an explicit completion/unlock performed by the test itself.
export function prepareJourneyFixture(app,action,p={}){
 if(action==='createTrainee'){p.email??='trainee@example.test';p.branch??='Test clinic';p.department??='Training';p.ownerId??=app.store.data.users.find(u=>u.role==='admin').id;}
 if(action==='draftHandover'){p.note??='Reviewed training summary';p.ownerName??='Next trainer';}
 const t=app.store.data.trainees.find(t=>t.id===p.traineeId);if(t)t.lifecycleRequired=false; // Explicit legacy fixtures; lifecycle enforcement has its own API suite.
 if(!t||action==='journeyStep')return;
 const step=journeyMutationStep(action,p,t,app.store.data.records)||(['materialContent','materialShareStatus','resourceShare'].includes(action)?'Learn':null);
 if(!step)return;
 if(!t.mentor||t.mentor.fixture)completeMentorFixture(t,app.store.data);
 for(const [i,name] of journeySteps.entries()){
  t.journeySteps??={};const existing=t.journeySteps[name];
  if(!existing||existing.fixture)t.journeySteps[name]={complete:i<journeySteps.indexOf(step),fixture:true};
 }
}
