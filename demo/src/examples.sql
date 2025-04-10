-- get all stops
SELECT * FROM stops

---

-- find all stops where the mode of transport is FERRY (4)
SELECT DISTINCT * FROM stops s WHERE s.stop_id IN (
  SELECT DISTINCT stop_id FROM stop_times st WHERE st.trip_id IN (
    SELECT trip_id FROM trips t WHERE t.route_id IN (
      SELECT DISTINCT route_id FROM routes r WHERE r.route_type='4'
    )
  )
)

---

-- get all stops by mode of transport (assuming 1:1)
SELECT DISTINCT st.stop_id,r.route_type FROM stop_times st
  INNER JOIN trips t ON st.trip_id = t.trip_id
  INNER JOIN routes r ON t.route_id = r.route_id

---

-- get operator by RSN
SELECT DISTINCT r.route_short_name,a.agency_name FROM routes r
  INNER JOIN agency a ON r.agency_id = a.agency_id

---

-- get stop_times by route
SELECT DISTINCT st.stop_id,st.stop_sequence,st.pickup_type,st.drop_off_type,r.route_short_name FROM stop_times st
  INNER JOIN trips t ON st.trip_id = t.trip_id
  INNER JOIN routes r ON t.route_id = r.route_id

---

-- get metadata about a table
PRAGMA table_info(stops)
