-- One-shot data fix: merge two user accounts that represent the same person.
-- Email user (kept):     01KQRPHT4E4J8WW0J6TDXY4AAR
-- Steam user (deleted):  01KQRQXF9VVZ0Q70FJV8ANE4AJ
--
-- Schema FK reminder (apps/worker/migrations/0003_init_groups.sql):
--   groups.creator_id          REFERENCES users(id)              -- RESTRICT (default), must move first
--   group_invites.created_by   REFERENCES users(id)              -- RESTRICT, must move first
--   group_members.user_id      REFERENCES users(id) ON DELETE CASCADE
--   oauth_accounts.user_id     REFERENCES users(id) ON DELETE CASCADE
--   sessions.user_id           REFERENCES users(id) ON DELETE CASCADE

-- 1. Move Steam OAuth identity onto the email user.
UPDATE oauth_accounts
   SET user_id = '01KQRPHT4E4J8WW0J6TDXY4AAR'
 WHERE user_id = '01KQRQXF9VVZ0Q70FJV8ANE4AJ';

-- 2. Reassign any groups created by the Steam user.
UPDATE groups
   SET creator_id = '01KQRPHT4E4J8WW0J6TDXY4AAR'
 WHERE creator_id = '01KQRQXF9VVZ0Q70FJV8ANE4AJ';

-- 3. Reassign any invites created by the Steam user.
UPDATE group_invites
   SET created_by = '01KQRPHT4E4J8WW0J6TDXY4AAR'
 WHERE created_by = '01KQRQXF9VVZ0Q70FJV8ANE4AJ';

-- 4. Move group memberships, but first dedupe (composite PK group_id+user_id
-- means we'd hit a unique violation if both users are already in the same group).
DELETE FROM group_members
 WHERE user_id = '01KQRQXF9VVZ0Q70FJV8ANE4AJ'
   AND group_id IN (
     SELECT group_id FROM group_members WHERE user_id = '01KQRPHT4E4J8WW0J6TDXY4AAR'
   );

UPDATE group_members
   SET user_id = '01KQRPHT4E4J8WW0J6TDXY4AAR'
 WHERE user_id = '01KQRQXF9VVZ0Q70FJV8ANE4AJ';

-- 5. Drop the Steam user's sessions (CASCADE would handle this on user delete,
-- but doing it explicitly makes the trail clearer and forces a re-sign-in via
-- Steam in that browser, which exercises the freshly-linked oauth_account row).
DELETE FROM sessions WHERE user_id = '01KQRQXF9VVZ0Q70FJV8ANE4AJ';

-- 6. Lift Steam display name + avatar onto the email user, but only if the
-- email user doesn't already have them.
UPDATE users
   SET display_name = COALESCE(
         (SELECT json_extract(provider_data, '$.personaname')
            FROM oauth_accounts
           WHERE user_id = '01KQRPHT4E4J8WW0J6TDXY4AAR' AND provider = 'steam'),
         display_name
       ),
       avatar_url   = COALESCE(
         avatar_url,
         (SELECT json_extract(provider_data, '$.avatarfull')
            FROM oauth_accounts
           WHERE user_id = '01KQRPHT4E4J8WW0J6TDXY4AAR' AND provider = 'steam')
       )
 WHERE id = '01KQRPHT4E4J8WW0J6TDXY4AAR';

-- 7. Delete the now-orphaned Steam user.
DELETE FROM users WHERE id = '01KQRQXF9VVZ0Q70FJV8ANE4AJ';

-- 8. Verification: should return exactly one user with the email + linked Steam.
SELECT u.id, u.email, u.display_name, u.avatar_url, oa.provider, oa.provider_user_id
  FROM users u
  LEFT JOIN oauth_accounts oa ON oa.user_id = u.id
 WHERE u.id = '01KQRPHT4E4J8WW0J6TDXY4AAR';
