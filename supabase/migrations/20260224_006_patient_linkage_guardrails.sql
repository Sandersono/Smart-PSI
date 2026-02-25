begin;

alter table public.patients
  add column if not exists anamnese text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ck_notes_patient_required'
      and conrelid = 'public.notes'::regclass
  ) then
    alter table public.notes
      add constraint ck_notes_patient_required
      check (patient_id is not null) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'ck_financial_records_patient_required'
      and conrelid = 'public.financial_records'::regclass
  ) then
    alter table public.financial_records
      add constraint ck_financial_records_patient_required
      check (patient_id is not null) not valid;
  end if;
end $$;

commit;
