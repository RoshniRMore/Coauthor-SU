import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
await fs.mkdir(dataDir, { recursive: true });

const departments = ['Biology','Chemistry','Physics','Psychology','Computer Science','Biomedical Engineering','Earth and Environmental Sciences','Public Health','Political Science','Sociology','History','English','Mathematics','Information Studies','Architecture'];
const topics = ['Climate resilience','Machine learning','Public health equity','Quantum materials','Civic media','Neural development','Water systems','Digital humanities','Autonomous systems','Inclusive education','Urban policy','Cellular metabolism','Cybersecurity','Migration studies','Renewable energy'];
const first = ['Avery','Jordan','Taylor','Morgan','Riley','Casey','Cameron','Quinn','Parker','Reese','Skyler','Drew','Alex','Jamie','Rowan','Emerson','Harper','Dakota','Hayden','Finley'];
const last = ['Adams','Bennett','Chen','Diaz','Evans','Foster','Gupta','Hassan','Ito','Johnson','Kim','Lopez','Martin','Nguyen','Owens','Patel','Rivera','Singh','Turner','Williams'];
const people = [], publications = [], projects = [];
for (let i = 0; i < 300; i++) {
  const id = `fallback-person-${i+1}`;
  const dept = departments[i % departments.length];
  const topic = topics[(i * 7) % topics.length];
  const pubIds = [], projIds = [];
  for (let j = 0; j < 4; j++) {
    const pid = `fallback-pub-${i+1}-${j+1}`;
    pubIds.push(pid);
    publications.push({id:pid,title:`${topic}: ${['methods','evidence','systems','applications'][j]} in ${dept}`,abstract:`A study of ${topic.toLowerCase()} using contemporary approaches from ${dept.toLowerCase()}, with implications for communities and future research.`,year:2023 + (j % 4),venue:`Journal of ${dept}`,author_ids:[id,`fallback-person-${((i+j+1)%300)+1}`],url:'https://experts.syr.edu/'});
  }
  if (i % 2 === 0) {
    const qid = `fallback-project-${i+1}`; projIds.push(qid);
    projects.push({id:qid,title:`Advancing ${topic} across communities`,description:`A sponsored research program investigating ${topic.toLowerCase()}.`,start_date:'2024-01-01',end_date:i%4===0?'2027-12-31':'2025-12-31',funder:['NSF','NIH','Department of Energy'][i%3],person_ids:[id,`fallback-person-${((i+1)%300)+1}`]});
  }
  people.push({id,name:`${first[i%first.length]} ${last[(i*3)%last.length]}`,title:i%5===0?'Associate Professor':'Professor',departments:[dept],profile_url:'https://experts.syr.edu/',publications:pubIds,projects:projIds,coauthors:[{id:`fallback-person-${((i+1)%300)+1}`,count:4,latest_year:2026}],synthetic:true});
}
const corpus = {meta:{source:'Synthetic fallback (live sources unreachable during build)',synthetic:true,generated_at:new Date().toISOString()},people,publications,projects};
await fs.writeFile(path.join(dataDir,'corpus.json'), JSON.stringify(corpus,null,2));
console.log(`corpus.json: ${people.length} people, ${publications.length} publications, ${projects.length} projects`);
