-- Load-test seed. Run against a THROWAWAY Supabase project, never Frankfurt prod.
-- Creates a school "LOAD" with N parents/teachers/drivers/students, password "Test1234!".
-- Adjust the loop counts at the top to match the scale you want to drive.

DO $$
DECLARE
  v_school_id   UUID;
  v_class_id    UUID;
  v_user_id     UUID;
  v_parent_id   UUID;
  v_driver_id   UUID;
  v_pwd         TEXT := crypt('Test1234!', gen_salt('bf', 10));
  -- Knobs
  n_parents     INT := 600;   -- doubles as student count (one student per parent)
  n_teachers    INT := 40;
  n_drivers     INT := 10;
  n_classes     INT := 12;
  -- Frankfurt-ish home coords; vary per parent for proximity tracking
  base_lat      DOUBLE PRECISION := 50.110;
  base_lng      DOUBLE PRECISION := 8.680;
  parent_ids    UUID[] := '{}';
  driver_ids    UUID[] := '{}';
  class_ids     UUID[] := '{}';
  i             INT;
BEGIN
  -- 1. School
  INSERT INTO schools (name, slug, abbreviation, is_active)
  VALUES ('Load Test School', 'load', 'LOAD', TRUE)
  RETURNING id INTO v_school_id;

  -- 2. One admin (handy for poking via the UI during the run)
  INSERT INTO users (school_id, username, password_hash, role, first_name, last_name, is_active, password_changed_at)
  VALUES (v_school_id, 'load_admin', v_pwd, 'admin', 'Load', 'Admin', TRUE, NOW());

  -- 3. Classes
  FOR i IN 1..n_classes LOOP
    INSERT INTO classes (school_id, name, grade_level, academic_year)
    VALUES (v_school_id, 'Class ' || i, ((i % 12) + 1)::TEXT, '2025-2026')
    RETURNING id INTO v_class_id;
    class_ids := array_append(class_ids, v_class_id);
  END LOOP;

  -- 4. Teachers
  FOR i IN 1..n_teachers LOOP
    INSERT INTO users (school_id, username, password_hash, role, first_name, last_name, is_active, password_changed_at)
    VALUES (v_school_id, 'load_teacher' || i, v_pwd, 'teacher', 'Teacher', i::TEXT, TRUE, NOW())
    RETURNING id INTO v_user_id;
    INSERT INTO teachers (school_id, user_id, full_name, subject)
    VALUES (v_school_id, v_user_id, 'Teacher ' || i, 'Subject ' || ((i % 6) + 1));
  END LOOP;

  -- 5. Drivers
  FOR i IN 1..n_drivers LOOP
    INSERT INTO users (school_id, username, password_hash, role, first_name, last_name, is_active, password_changed_at)
    VALUES (v_school_id, 'load_driver' || i, v_pwd, 'driver', 'Driver', i::TEXT, TRUE, NOW())
    RETURNING id INTO v_user_id;
    INSERT INTO drivers (school_id, user_id, full_name, vehicle_type)
    VALUES (v_school_id, v_user_id, 'Driver ' || i, 'bus')
    RETURNING id INTO v_driver_id;
    driver_ids := array_append(driver_ids, v_driver_id);
  END LOOP;

  -- 6. Parents (each with home lat/long for proximity alerts)
  FOR i IN 1..n_parents LOOP
    INSERT INTO users (school_id, username, password_hash, role, first_name, last_name, is_active, password_changed_at)
    VALUES (v_school_id, 'load_parent' || i, v_pwd, 'parent', 'Parent', i::TEXT, TRUE, NOW())
    RETURNING id INTO v_user_id;
    INSERT INTO parents (school_id, user_id, full_name, latitude, longitude)
    VALUES (
      v_school_id, v_user_id, 'Parent ' || i,
      base_lat + (random() - 0.5) * 0.05,
      base_lng + (random() - 0.5) * 0.05
    )
    RETURNING id INTO v_parent_id;
    parent_ids := array_append(parent_ids, v_parent_id);
  END LOOP;

  -- 7. Students (one per parent, round-robin class & driver, copy parent's coords as home)
  FOR i IN 1..n_parents LOOP
    INSERT INTO students (
      school_id, full_name, class_id, parent_id, driver_id,
      home_latitude, home_longitude
    )
    SELECT
      v_school_id,
      'Student ' || i,
      class_ids[((i - 1) % n_classes) + 1],
      parent_ids[i],
      driver_ids[((i - 1) % n_drivers) + 1],
      p.latitude, p.longitude
    FROM parents p WHERE p.id = parent_ids[i];
  END LOOP;

  RAISE NOTICE 'Seeded school % with % parents, % teachers, % drivers, % students',
    v_school_id, n_parents, n_teachers, n_drivers, n_parents;
END $$;

-- Cleanup helper (run when you're done):
-- DELETE FROM schools WHERE abbreviation = 'LOAD';
