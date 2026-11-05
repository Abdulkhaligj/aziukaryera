-- The data dump already contains private.avatar_generations, whose insert
-- trigger refuses to reuse an avatar path. Storage files are re-uploaded under
-- their original paths, and each upload records its generation again.
truncate private.avatar_generations;
