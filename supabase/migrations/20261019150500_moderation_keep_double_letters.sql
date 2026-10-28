-- Collapse only runs of 3+ identical letters (fuuuuck -> fuck) and keep doubles, so
-- sikkə/sik, yarraq/yaraq, nigger/Niger and cazzo/cazo stay distinct.

create or replace function private.mod_skel(p_tok text, p_script text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(
           regexp_replace(private.mod_map(p_tok, p_script),
             case p_script when 'latin' then '[^a-z]' when 'cyrillic' then E'[^\u0430-\u044F]' else E'[^\u0621-\u063A\u0641-\u064A\u0671-\u06D3]' end, '', 'g'),
           '(.)\1{2,}', '\1', 'g');
$$;

-- Masked token (f*ck) as a regex with one '.' per hidden letter, or null.
create or replace function private.mod_mask(p_tok text, p_script text)
returns text language plpgsql immutable parallel safe set search_path = '' as $$
declare
  s text;
  v_letters integer;
  v_masks integer;
begin
  if p_tok !~ E'[a-z\u0259\u0131\u0142\u00F8\u0111\u00DF\u00E6\u0153\u00FE\u0430-\u044F\u0456\u0457\u0454\u0491\u045E\u0455\u0458\u04BB\u0501\u051B\u051D\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u03B1-\u03C90-9@$][*#%?_\u2022\u00B7]+[a-z\u0259\u0131\u0142\u00F8\u0111\u00DF\u00E6\u0153\u00FE\u0430-\u044F\u0456\u0457\u0454\u0491\u045E\u0455\u0458\u04BB\u0501\u051B\u051D\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u03B1-\u03C90-9@$]|[a-z\u0259\u0131\u0142\u00F8\u0111\u00DF\u00E6\u0153\u00FE\u0430-\u044F\u0456\u0457\u0454\u0491\u045E\u0455\u0458\u04BB\u0501\u051B\u051D\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u03B1-\u03C90-9@$][*#%?_\u2022\u00B7]+$' then return null; end if;
  s := private.mod_map(translate(p_tok, E'*#%?_\u2022\u00B7', E'\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7'), p_script);
  s := regexp_replace(s, case p_script when 'latin' then E'[^a-z\u00B7]' when 'cyrillic' then E'[^\u0430-\u044F\u00B7]' else E'[^\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u00B7]' end, '', 'g');
  s := regexp_replace(s, E'([^\u00B7])\\1{2,}', '\1', 'g');
  v_masks := length(s) - length(replace(s, E'\u00B7', ''));
  v_letters := length(s) - v_masks;
  if v_letters < 2 or v_masks < 1 or v_masks > v_letters then return null; end if;
  return replace(s, E'\u00B7', '.');
end $$;

-- Every candidate the matcher checks: token skeletons, masked patterns,
-- runs of 3+ single letters ("s i k t i r") and short pairs ("fu ck").
create or replace function private.mod_candidates(p text)
returns table(script text, cand text, kind text)
language plpgsql immutable parallel safe set search_path = '' as $$
declare
  toks text[] := private.mod_tokens(p);
  n integer := coalesce(array_length(toks, 1), 0);
  sk jsonb := '{}';
  sc text;
  k text;
  pat text;
  run text;
  run_len integer;
  a text;
  b text;
begin
  for i in 1 .. n loop
    foreach sc in array private.mod_scripts(toks[i]) loop
      k := private.mod_skel(toks[i], sc);
      if k <> '' then
        script := sc; cand := k; kind := 'token'; return next;
        sk := jsonb_set(sk, array[sc], coalesce(sk -> sc, '{}') || jsonb_build_object(i::text, k), true);
      end if;
      pat := private.mod_mask(toks[i], sc);
      if pat is not null then
        script := sc; cand := pat; kind := 'mask'; return next;
      end if;
    end loop;
  end loop;

  foreach sc in array array['latin', 'cyrillic', 'arabic'] loop
    run := ''; run_len := 0;
    for i in 1 .. n + 1 loop
      k := sk -> sc ->> i::text;
      if k is not null and length(k) = 1 then
        run := run || k; run_len := run_len + 1;
        continue;
      end if;
      if run_len >= 3 then
        script := sc; cand := regexp_replace(run, '(.)\1{2,}', '\1', 'g'); kind := 'run'; return next;
      end if;
      run := ''; run_len := 0;
    end loop;
    for i in 1 .. n - 1 loop
      a := sk -> sc ->> i::text;
      b := sk -> sc ->> (i + 1)::text;
      if a is not null and b is not null and greatest(length(a), length(b)) <= 4 then
        script := sc; cand := regexp_replace(a || b, '(.)\1{2,}', '\1', 'g'); kind := 'bigram'; return next;
      end if;
    end loop;
  end loop;
end $$;


revoke execute on function private.mod_skel(text, text) from public, anon, authenticated;
revoke execute on function private.mod_mask(text, text) from public, anon, authenticated;
revoke execute on function private.mod_candidates(text) from public, anon, authenticated;
