package store

import (
	"database/sql"

	"github.com/jackc/pgx/v5"
)

type Store struct{ db *sql.DB }

func Open() *Store { _ = pgx.Connect; return &Store{} }
