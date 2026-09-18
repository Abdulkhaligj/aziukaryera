'use client';

import { useMemo, useState } from 'react';
import {
  Building2, BriefcaseBusiness, CalendarDays, Gift, FileCheck2, Users, LayoutDashboard,
  PanelsTopLeft, ShieldCheck, ScrollText, Search, Plus, MoreHorizontal, Bell, ChevronDown,
  TrendingUp, UserCheck, Clock3, X, Save, Trash2, Menu
} from 'lucide-react';
import type { AdminRow, ResourceKey, Status } from '@/lib/types';

type Store = Record<ResourceKey, AdminRow[]>;
type NavItem = {key:'dashboard'|ResourceKey;label:string;icon:React.ComponentType<{size?:number}>;group:string};
const nav:NavItem[] = [
  {key:'dashboard',label:'İcmal',icon:LayoutDashboard,group:'İdarəetmə'},
  {key:'jobs',label:'Vakansiyalar',icon:BriefcaseBusiness,group:'Məzmun'},
  {key:'companies',label:'Şirkətlər',icon:Building2,group:'Məzmun'},
  {key:'events',label:'Tədbirlər',icon:CalendarDays,group:'Məzmun'},
  {key:'benefits',label:'Tələbə güzəştləri',icon:Gift,group:'Məzmun'},
  {key:'applications',label:'Müraciətlər',icon:FileCheck2,group:'İnsanlar'},
  {key:'students',label:'Tələbələr',icon:Users,group:'İnsanlar'},
  {key:'content',label:'Sayt məzmunu',icon:PanelsTopLeft,group:'Sistem'},
  {key:'admins',label:'Əməkdaşlar və rollar',icon:ShieldCheck,group:'Sistem'},
  {key:'audit_logs',label:'Əməliyyat tarixçəsi',icon:ScrollText,group:'Sistem'}
];
const titles:Record<ResourceKey,string>={jobs:'Vakansiyalar',companies:'Şirkətlər',events:'Tədbirlər',benefits:'Tələbə güzəştləri',applications:'Müraciətlər',students:'Tələbələr',content:'Sayt məzmunu',admins:'Əməkdaşlar və rollar',audit_logs:'Əməliyyat tarixçəsi'};
const addable = new Set<ResourceKey>(['jobs','companies','events','benefits','content','admins']);

function Stat({label,value,note,icon:Icon,tone}:{label:string;value:string;note:string;icon:React.ComponentType<{size?:number}>;tone:string}){
  return <article className="statCard"><div className={`statIcon ${tone}`}><Icon size={20}/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function StatusPill({status}:{status:Status}) { return <span className={`status status-${status.toLowerCase()}`}>{status}</span>; }

export default function AdminShell({initialData,demoMode}:{initialData:Store;demoMode:boolean}){
  const [active,setActive]=useState<'dashboard'|ResourceKey>('dashboard');
  const [data,setData]=useState<Store>(initialData);
  const [query,setQuery]=useState('');
  const [modal,setModal]=useState<{mode:'create'|'edit';row?:AdminRow}|null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const current = active==='dashboard'?[]:data[active];
  const filtered = useMemo(()=>current.filter(row=>(row.title+' '+row.subtitle+' '+row.meta).toLowerCase().includes(query.toLowerCase())),[current,query]);
  const activeJobs=data.jobs.filter(x=>x.status==='Aktiv').length;
  const activeEvents=data.events.filter(x=>x.status==='Aktiv').length;

  function saveRow(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault(); if(active==='dashboard') return;
    const fd=new FormData(event.currentTarget);
    const row:AdminRow={
      id:modal?.row?.id||crypto.randomUUID(),title:String(fd.get('title')),subtitle:String(fd.get('subtitle')),
      status:String(fd.get('status')) as Status,meta:String(fd.get('meta')),updatedAt:'İndi'
    };
    setData(prev=>({...prev,[active]:modal?.mode==='edit'?prev[active].map(x=>x.id===row.id?row:x):[row,...prev[active]]}));
    setModal(null);
  }
  function removeRow(row:AdminRow){ if(active==='dashboard')return; setData(prev=>({...prev,[active]:prev[active].filter(x=>x.id!==row.id)})); setModal(null); }

  return <div className="adminApp">
    <aside className={`sidebar ${menuOpen?'sidebarOpen':''}`}>
      <div className="brand"><span className="brandMark">A</span><div><b>ASOIU</b><span>Karyera Mərkəzi</span><small>ADMIN</small></div><button className="mobileClose" onClick={()=>setMenuOpen(false)}><X size={20}/></button></div>
      <nav>{['İdarəetmə','Məzmun','İnsanlar','Sistem'].map(group=><div className="navGroup" key={group}><p>{group}</p>{nav.filter(n=>n.group===group).map(item=>{const Icon=item.icon;return <button className={active===item.key?'active':''} key={item.key} onClick={()=>{setActive(item.key);setQuery('');setMenuOpen(false)}}><Icon size={18}/><span>{item.label}</span>{item.key==='applications'&&<em>{data.applications.length}</em>}</button>})}</div>)}</nav>
      <div className="sidebarFoot"><div className="miniAvatar">KM</div><div><b>Karyera Mərkəzi</b><span>Super Admin</span></div><ChevronDown size={16}/></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="pageIdentity"><button className="menuButton" onClick={()=>setMenuOpen(true)}><Menu size={20}/></button><div><h1>{active==='dashboard'?'İdarəetmə paneli':titles[active]}</h1><p>{active==='dashboard'?'Platformanın bugünkü vəziyyəti':`${data[active].length} qeyd · idarə et və yayımla`}</p></div></div><div className="topActions">{demoMode&&<span className="demoBadge">Demo rejimi</span>}<button className="iconButton"><Bell size={19}/><i/></button><button className="profileButton"><span>KM</span><div><b>Karyera Mərkəzi</b><small>Super Admin</small></div><ChevronDown size={15}/></button></div></header>
      <section className="content">
        {active==='dashboard'?<>
          <div className="welcome"><div><span>18 sentyabr 2026 · Cümə</span><h2>Salam, Karyera Mərkəzi komandası</h2><p>Saytdakı məlumatları, müraciətləri və tərəfdaşları buradan idarə edə bilərsiniz.</p></div><button className="primaryButton" onClick={()=>{setActive('jobs');setModal({mode:'create'})}}><Plus size={18}/>Yeni elan yarat</button></div>
          <div className="statsGrid"><Stat label="Aktiv vakansiyalar" value={String(activeJobs)} note="3 yeni bu həftə" icon={BriefcaseBusiness} tone="blue"/><Stat label="Gözləyən müraciətlər" value={String(data.applications.length)} note="12-si bu gün" icon={Clock3} tone="amber"/><Stat label="Aktiv tələbələr" value="1 284" note="+8.4% bu ay" icon={UserCheck} tone="green"/><Stat label="Yaxın tədbirlər" value={String(activeEvents)} note="226 qeydiyyat" icon={CalendarDays} tone="violet"/></div>
          <div className="dashboardGrid"><section className="panel"><div className="panelHead"><div><h3>Son müraciətlər</h3><p>Komandanın cavabını gözləyən namizədlər</p></div><button onClick={()=>setActive('applications')}>Hamısına bax</button></div><div className="compactRows">{data.applications.map(row=><div className="compactRow" key={row.id}><span className="avatarCircle">{row.title.split(' ').map(x=>x[0]).join('').slice(0,2)}</span><div><b>{row.title}</b><small>{row.subtitle}</small></div><StatusPill status={row.status}/><time>{row.updatedAt}</time></div>)}</div></section><section className="panel"><div className="panelHead"><div><h3>Platforma aktivliyi</h3><p>Son 30 gün</p></div><TrendingUp size={20}/></div><div className="chart"><div style={{height:'34%'}}/><div style={{height:'48%'}}/><div style={{height:'43%'}}/><div style={{height:'70%'}}/><div style={{height:'62%'}}/><div style={{height:'82%'}}/><div style={{height:'92%'}}/></div><div className="chartLegend"><span>19 Avq</span><span>18 Sen</span></div><div className="chartTotal"><strong>4 826</strong><span>səhifə baxışı</span></div></section></div>
          <section className="panel"><div className="panelHead"><div><h3>Tez idarəetmə</h3><p>Ən çox istifadə olunan bölmələr</p></div></div><div className="quickGrid">{nav.filter(x=>['jobs','companies','events','benefits'].includes(x.key)).map(item=>{const Icon=item.icon;return <button key={item.key} onClick={()=>setActive(item.key)}><Icon size={22}/><div><b>{item.label}</b><span>{data[item.key as ResourceKey].length} qeyd</span></div><ChevronDown size={16}/></button>})}</div></section>
        </>:<>
          <div className="tableTools"><div className="searchBox"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={`${titles[active]} üzrə axtar...`}/></div><select><option>Bütün statuslar</option><option>Aktiv</option><option>Qaralama</option><option>Yoxlamada</option></select>{addable.has(active)&&<button className="primaryButton" onClick={()=>setModal({mode:'create'})}><Plus size={18}/>Yeni əlavə et</button>}</div>
          <section className="panel tablePanel"><div className="dataTable"><div className="tableHeader"><span>Ad və məlumat</span><span>Status</span><span>Əlavə məlumat</span><span>Yenilənib</span><span/></div>{filtered.map(row=><div className="tableRow" key={row.id}><div className="mainCell"><span className="resourceIcon">{row.title[0]}</span><div><b>{row.title}</b><small>{row.subtitle}</small></div></div><StatusPill status={row.status}/><span className="metaCell">{row.meta}</span><time>{row.updatedAt}</time><button className="rowMenu" onClick={()=>setModal({mode:'edit',row})}><MoreHorizontal size={20}/></button></div>)}{filtered.length===0&&<div className="emptyState"><Search size={28}/><b>Nəticə tapılmadı</b><span>Axtarış sözünü dəyişin.</span></div>}</div></section>
        </>}
      </section>
    </main>
    {modal&&active!=='dashboard'&&<div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(null)}}><form className="modal" onSubmit={saveRow}><div className="modalHead"><div><h2>{modal.mode==='create'?'Yeni qeyd əlavə et':'Qeydi redaktə et'}</h2><p>{titles[active]} bölməsi</p></div><button type="button" onClick={()=>setModal(null)}><X size={20}/></button></div><label>Başlıq<input name="title" defaultValue={modal.row?.title} required/></label><label>Alt məlumat<input name="subtitle" defaultValue={modal.row?.subtitle} required/></label><div className="formGrid"><label>Status<select name="status" defaultValue={modal.row?.status||'Qaralama'}><option>Aktiv</option><option>Qaralama</option><option>Yoxlamada</option><option>Bitib</option></select></label><label>Əlavə məlumat<input name="meta" defaultValue={modal.row?.meta} required/></label></div><div className="modalActions">{modal.mode==='edit'&&<button type="button" className="dangerButton" onClick={()=>modal.row&&removeRow(modal.row)}><Trash2 size={17}/>Sil</button>}<span/><button type="button" className="secondaryButton" onClick={()=>setModal(null)}>Ləğv et</button><button className="primaryButton" type="submit"><Save size={17}/>Yadda saxla</button></div></form></div>}
  </div>;
}
