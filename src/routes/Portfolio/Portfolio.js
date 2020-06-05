import React, { useState, useEffect } from "react";
import { useHistory, useRouteMatch } from "react-router-dom";
import Project from "../Project/Project";
import Container from "@material-ui/core/Container";
import Grid from "@material-ui/core/Grid";
import Typography from "@material-ui/core/Typography";
import Grow from "@material-ui/core/Grow";

import PortfolioItems from "../../components/PortfolioItems/PortfolioItems";
import ErrorComponent from "../../components/ErrorComponent/ErrorComponent";
import Filters from "../../components/Filters/Filters";
import useFetch from "../../hooks/useFetch";

import { getFiltersArray } from "../../utils/helpers";

const Portfolio = () => {
  const history = useHistory();
  const routeMatch = useRouteMatch("/portfolio/:id");
  const isExact = routeMatch && routeMatch.isExact;
  const [selectedFilter, setSelectedFilter] = useState(null);
  const [{ data, isError, errorData }] = useFetch("projects");
  const [filteredProjects, setFilteredProjects] = useState(data);
  const filterArray = getFiltersArray("primary_technologies");

  useEffect(() => {
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
  }, [data, selectedFilter]);

  const openProjectDialog = (projectInfo) => {
    history.push(`/portfolio/${projectInfo._id}`);
  };

  return (
    <Grid container item xs={12} justify="center">
      <Typography gutterBottom={true} variant="h3">
        Sites Built
      </Typography>
      {isError ? (
        <ErrorComponent errorData={errorData} />
      ) : (
        <>
          <Filters
            selectedFilter={selectedFilter}
            setSelectedFilter={setSelectedFilter}
            filters={filterArray}
          />
          <Grid container spacing={2} justify="flex-start">
            {filteredProjects.map(
              (project, index) =>
                project.active && (
                  <Grow
                    key={project._id}
                    in={filteredProjects.length > 0}
                    style={{ transformOrigin: "0 0 0" }}
                    {...(filteredProjects.length > 0
                      ? { timeout: index * 1000 }
                      : {})}
                  >
                    <PortfolioItems
                      data={project}
                      openProjectDialog={openProjectDialog}
                    />
                  </Grow>
                )
            )}
          </Grid>
        </>
      )}
      {isExact && <Project />}
    </Grid>
  );
};

export default Portfolio;
