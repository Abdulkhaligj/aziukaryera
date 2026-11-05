-- Row counts compared between the cloud project and the new server.
select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.companies', count(*) from public.companies
union all select 'public.jobs', count(*) from public.jobs
union all select 'public.applications', count(*) from public.applications
union all select 'public.posts', count(*) from public.posts
union all select 'public.post_comments', count(*) from public.post_comments
union all select 'public.notifications', count(*) from public.notifications
union all select 'storage.buckets', count(*) from storage.buckets
union all select 'storage.objects', count(*) from storage.objects
union all select 'cron.job', count(*) from cron.job;
