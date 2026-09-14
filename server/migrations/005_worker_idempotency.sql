-- ON CONFLICT needs read access to the conflict key, not message bodies.
GRANT SELECT(author_id,client_nonce) ON noctis.messages TO noctis_worker;
