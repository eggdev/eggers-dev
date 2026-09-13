ALTER TABLE hotels ADD COLUMN analysis_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE hotels ADD COLUMN coverage_tags_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE hotel_destination_links (
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  PRIMARY KEY (hotel_id, destination_id)
);

INSERT INTO hotel_destination_links (hotel_id, destination_id)
SELECT id, destination_id FROM hotels;

CREATE INDEX hotel_destination_links_destination_idx
  ON hotel_destination_links(destination_id);
