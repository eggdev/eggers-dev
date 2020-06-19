import React, { useState, useEffect } from "react";
import Project from "../components/Project/Project";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import { useTheme } from "@material-ui/core/styles";
import useMediaQuery from "@material-ui/core/useMediaQuery";
import PortfolioItems from "../components/PortfolioItems/PortfolioItems";
import Filters from "../components/Filters/Filters";
import fetch from "isomorphic-unfetch";

import { getFiltersArray } from "../utils/helpers";

const Portfolio = ({ data }) => {
  const [projectInfo, setProjectInfo] = useState(null);
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [filteredProjects, setFilteredProjects] = useState(data);
  const filterArray = getFiltersArray("primary_technologies");
  const theme = useTheme();
  const matchDesktop = useMediaQuery(theme.breakpoints.up("md"));

  useEffect(() => {
    setFilteredProjects([]);
    if (data.length > 0) {
      setTimeout(() => {
        setFilteredProjects(
          selectedFilter
            ? [
                ...data.filter(
                  (a) =>
                    a.primary_technologies.includes(selectedFilter) ||
                    a.secondary_technologies.includes(selectedFilter)
                ),
              ]
            : [...data]
        );
      }, 100);
    }
  }, [data, selectedFilter]);

  const openProjectDialog = (project_data) => {
    setProjectInfo(project_data);
  };

  return (
    <Grid container item xs={12} justify="center">
      <Typography gutterBottom={true} variant="h3">
        Sites Built
      </Typography>
      {matchDesktop && (
        <Filters
          selectedFilter={selectedFilter}
          setSelectedFilter={setSelectedFilter}
          filters={filterArray}
        />
      )}
      <Grid container spacing={2} justify="flex-start">
        {filteredProjects.length > 0 &&
          filteredProjects.map(
            (project, index) =>
              project.active && (
                <PortfolioItems
                  key={project._id}
                  index={index}
                  data={project}
                  openProjectDialog={openProjectDialog}
                />
              )
          )}
      </Grid>
      {Boolean(projectInfo) && (
        <Project projectData={projectInfo} setProjectData={setProjectInfo} />
      )}
    </Grid>
  );
};

export async function getStaticProps() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects`);
  const json = await res.json();
  return {
    props: {
      data: json,
    },
  };
}

export default Portfolio;
