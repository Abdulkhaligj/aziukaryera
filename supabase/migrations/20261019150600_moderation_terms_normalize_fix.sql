-- One trigger function serves moderation_terms (term) and moderation_allow (word);
-- read the column through jsonb so each table only touches its own field.
create or replace function private.moderation_terms_normalize()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_script text;
  v_term text;
  v_input text := to_jsonb(new) ->> case when tg_table_name = 'moderation_allow' then 'word' else 'term' end;
begin
  select t.script, t.term into v_script, v_term from private.mod_term(v_input) t;
  if v_term is null then
    raise exception 'Söz tanınmadı: bir əlifbada yazılmış söz və ya söz birləşməsi əlavə edin' using errcode = 'check_violation';
  end if;
  if tg_table_name = 'moderation_allow' then
    new.word := v_term;
  else
    new.term := v_term;
  end if;
  new.script := v_script;
  return new;
end $$;

revoke execute on function private.moderation_terms_normalize() from public, anon, authenticated;
