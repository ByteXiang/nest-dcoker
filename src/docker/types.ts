export interface DockerHubSearchResult {
  repo_name: string
  is_official: boolean
  description?: string
  short_description?: string
  star_count: number
  pull_count: number
  is_automated: boolean
  matched_tag?: string | null
  available_tags?: string[]
}
