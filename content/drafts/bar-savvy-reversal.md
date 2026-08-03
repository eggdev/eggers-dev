Bar Savvy started with a public record most people don't know exists: Texas publishes what every bar sells in alcohol, every month, by venue. In 2023 I was still working at the NBA, and as a side project on my own machine I started joining that record with public venue data and putting the result on a map. If you were thinking about opening a bar, you could pull up a neighborhood and see what the bars already there actually sold, not what they claimed. That map was the whole first product.

A simple map, it turns out, is not simple to run. Behind it sat pipelines pulling the state records, an API, accounts and subscriptions, search, and the servers underneath all of it. At the NBA I had owned my slice of a large system. Here every part was mine, including the parts I had never run before, and every tool I chose I would also have to operate.

I picked Elasticsearch for search because I already knew it. There was a real argument too: I believed full-text search with faceted filters would beat anything I could get out of SQL. But the argument came second to the comfort. So search became its own service, holding a second copy of the data that had to be kept in sync.

No failure forced this. What changed my mind was a prototype I built for something else, an internal experiment that never went anywhere, where I used plain PostgreSQL. The filters worked. The text search was fine. I had been carrying a whole second system to get something Postgres could apparently do, and I only learned that by accident.

So I moved search into Postgres, with PostGIS, the part of the database that understands geography, doing the work a map product needs. Deleting Elasticsearch deleted a category of work along with it: the duplicate models, the sync job, the stale results, and a monthly bill for the privilege. Operators noticed nothing, which was the point. I noticed how much of my week came back.

Search wasn't the only place I had done this. The whole thing ran on Kubernetes, because Kubernetes was what I had been around at the NBA. To be fair to past me, it matched the shape of the system: an API, background workers, Redis, search, each able to ship on its own. It felt like building the platform properly. It was a platform for a team I didn't have.

When Bar Savvy moved onto Vercel and Supabase, the cluster went away, and with it the certificates, the release plumbing, and the care and feeding of every service in between. I had learned a lot running it, and I don't miss it.

I don't have a tidy rule from all this. "Use boring technology" is close, but it isn't what happened. I used the technology I found interesting, and the product told me, slowly and through my calendar, what it was willing to pay for. What I have instead is a habit: when I catch myself defending a piece of the system by what it could handle someday, I go look at what it did this week.
