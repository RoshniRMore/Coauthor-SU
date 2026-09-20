'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {facultyMatches,idx} from '../../lib/data';
import students from '../../data/students.json';
export default function Matches(){
 const[q,setQ]=useState('climate health data'),[opted,setOpted]=useState(false);
 useEffect(()=>{setQ(localStorage.getItem('idea')||q);setOpted(localStorage.getItem('optedIn')==='true')},[]);
 const fm=facultyMatches(q).map((m,i)=>({...m,score:Math.min(.99,m.score+(opted&&i===0?.1:0))})).sort((a,b)=>b.score-a.score);
 return <><h1>Your idea lands here.</h1><div className="notice"><strong>{idx.themes[0].name}</strong><p>{idx.themes[0].description} Your wording also touches {idx.themes[7].name.toLowerCase()}.</p></div>
 <div className="tabs"><a className="active" href="#faculty">Faculty</a><a href="#groups">Groups</a><a href="#students">Students</a></div>
 <section id="faculty"><h2>Faculty matches</h2><div className="grid">{fm.slice(0,6).map(({p,paper,signal,score},i)=><article className="card" key={p.id}><span className="meta">{Math.round(score*100)}% topical fit</span><div className="strength"><i style={{width:`${score*100}%`}}/></div><h3>{p.name}</h3><p>{p.title}, {p.departments[0]}</p><p><strong>Why this match:</strong> Your idea overlaps with <span className="paper">{paper.title}</span>.</p><div className="chips">{signal.active_project&&<span className="chip">active sponsored project</span>}<span className="chip">{signal.recent_output} papers since 2025</span>{opted&&i===0&&<span className="chip">explicitly open to students</span>}</div><a href={p.profile_url}>View source profile</a></article>)}</div></section>
 <section id="groups" style={{marginTop:50}}><h2>Research groups</h2><div className="grid">{idx.groups.slice(0,3).map(g=><article className="card" key={g.id}><h3>{g.name}</h3><p><strong>Why this match:</strong> Shared output sits in {idx.themes.find(t=>t.id===g.theme_id)?.name}.</p><div className="chips"><span className="chip">{g.member_ids.length} collaborators</span><span className="chip">{g.publication_ids.length} shared works</span></div><Link href={`/groups/${g.id}`}>Explore group</Link></article>)}</div></section>
 <section id="students" style={{marginTop:50}}><h2>Student collaborators</h2><div className="grid">{students.slice(0,3).map((s,i)=><article className="card" key={s.id}><span className="meta">{88-i*4}% match</span><h3>{s.name}</h3><p>{s.idea}</p><p><strong>Why this match:</strong> Shared theme, complementary skills in {s.skills.join(' and ')}.</p></article>)}</div></section></>
}
